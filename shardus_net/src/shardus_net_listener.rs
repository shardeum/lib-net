use super::runtime::RUNTIME;
use crate::header::header_types::RequestMetadata;
use crate::header_factory::header_deserialize_factory;
use crate::message::Message;
use crate::shardus_crypto;
use crate::NetConfig;
use log::{error, info};
use std::io::Cursor;
use std::net::{SocketAddr, ToSocketAddrs};
use std::string::FromUtf8Error;
use thiserror::Error;
use tokio::io::AsyncReadExt;
use tokio::net::TcpListener;
use tokio::net::TcpStream;
use tokio::sync::mpsc::error::SendError;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

pub struct ShardusNetListener {
    address: SocketAddr,
    net_config: NetConfig,
}

#[derive(Error, Debug)]
#[allow(clippy::enum_variant_names)]
pub enum ListenerError {
    #[error("Failed to parse data as Utf8. {0}")]
    ParseDataAsUtf8Error(#[from] FromUtf8Error),
    #[error("Failed to notify callback with received message. {0}")]
    SendCompleteError(#[from] SendError<()>),
    #[error("Failed to read from TCPStream. {0}")]
    ReadStreamError(#[from] std::io::Error),
}

type ListenerResult<T> = Result<T, ListenerError>;

impl ShardusNetListener {
    pub fn new<A: ToSocketAddrs>(address: A, net_config: NetConfig) -> Result<Self, ()> {
        let mut addresses = address.to_socket_addrs().map_err(|_| ())?;
        let address = addresses.next().ok_or(())?;

        Ok(Self { address, net_config })
    }

    pub fn listen(&self) -> UnboundedReceiver<(String, SocketAddr, Option<RequestMetadata>)> {
        Self::spawn_listener(self.address, self.net_config)
    }

    fn spawn_listener(address: SocketAddr, net_config: NetConfig) -> UnboundedReceiver<(String, SocketAddr, Option<RequestMetadata>)> {
        let (tx, rx) = unbounded_channel();
        RUNTIME.spawn(Self::bind_to_socket(address, tx, net_config));
        rx
    }

    async fn bind_to_socket(address: SocketAddr, tx: UnboundedSender<(String, SocketAddr, Option<RequestMetadata>)>, net_config: NetConfig) {
        loop {
            let listener = TcpListener::bind(address).await;

            match listener {
                Ok(listener) => {
                    let tx = tx.clone();
                    match Self::accept_connections(listener, tx, net_config.clone()).await {
                        Ok(_) => unreachable!(),
                        Err(err) => {
                            error!("Failed to accept connection to {} due to {}", address, err)
                        }
                    }
                }
                Err(err) => error!("Failed to listen to {} due to {}", address, err),
            };

            tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
        }
    }

    async fn accept_connections(listener: TcpListener, received_msg_tx: UnboundedSender<(String, SocketAddr, Option<RequestMetadata>)>, net_config: NetConfig) -> std::io::Result<()> {
        loop {
            let (socket, remote_addr) = listener.accept().await?;
            let received_msg_tx = received_msg_tx.clone();
            let net_config = net_config.clone();

            RUNTIME.spawn(async move {
                let result = Self::receive(socket, remote_addr, received_msg_tx, net_config).await;
                match result {
                    Ok(_) => info!("Connection safely completed and shutdown with {}", remote_addr),
                    Err(err) => {
                        error!("Connection to {} failed with Error: {}", remote_addr, err)
                    }
                };
            });
        }
    }

    async fn receive(socket_stream: TcpStream, remote_addr: SocketAddr, received_msg_tx: UnboundedSender<(String, SocketAddr, Option<RequestMetadata>)>, net_config: NetConfig) -> ListenerResult<()> {
        let mut socket_stream: TcpStream = socket_stream;
        while let Ok(msg_len) = socket_stream.read_u32().await {
            if (msg_len as usize) > net_config.payload_size_limit {
                error!("Message length exceeds the limit of {} bytes", net_config.payload_size_limit);
                continue;
            }

            let mut buffer: Vec<u8> = vec![0; msg_len as usize];

            // @TODO: Do a security check in the case that a sender sends an incorrect length.

            // SAFETY: We can set the length of the vec here since we know that:
            // 1. The capacity has been set above and the length is <= capacity.
            // 2. We are calling read_exact which will fill the full length of the array.
            unsafe {
                buffer.set_len(msg_len as usize);
            }

            socket_stream.read_exact(&mut buffer).await?;

            if !buffer.is_empty() && buffer[0] == 0x1 {
                // Header is present
                let msg_bytes = &buffer[1..];

                let mut cursor = Cursor::new(msg_bytes.to_vec());
                let message = Message::deserialize(&mut cursor, net_config).expect("Failed to deserialize message");
                if !message.verify(shardus_crypto::get_shardus_crypto_instance()) {
                    error!("Failed to verify message signature");
                    continue;
                }
                info!("Message verified!");

                let header_cursor = &mut Cursor::new(message.header);
                let header = header_deserialize_factory(message.header_version, header_cursor, net_config).expect("Failed to deserialize header");

                let data = message.data;

                if !header.validate(data.clone()) {
                    error!("Failed to validate data with header");
                    continue;
                }

                let request_metadata = RequestMetadata {
                    version: message.header_version,
                    header_json_string: header.to_json_string(),
                    sign_json_string: message.sign.to_json_string(),
                };

                let decompressed_data_bytes = header.decompress(data.as_slice()).expect("Failed to decompress message");

                // deserialize remaining bytes as your message
                let msg = String::from_utf8(decompressed_data_bytes.to_vec())?;
                info!("Received message: {}", msg);
                received_msg_tx.send((msg, remote_addr, Some(request_metadata))).map_err(|_| SendError(()))?;
            } else {
                // No header present
                let msg = String::from_utf8(buffer)?;
                received_msg_tx.send((msg, remote_addr, None)).map_err(|_| SendError(()))?;
            }
        }

        Ok(())
    }
}
