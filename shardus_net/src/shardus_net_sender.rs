use super::runtime::RUNTIME;
use crate::header::header_types::Header;
use crate::header_factory::{header_serialize_factory, wrap_serialized_message};
use crate::message::Message;
use crate::oneshot::Sender;
use crate::shardus_crypto;
use log::error;
#[cfg(debug)]
use log::info;
use std::collections::HashMap;

use std::io;
use std::net::SocketAddr;

use lru::LruCache;
use std::sync::Arc;
use thiserror::Error;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use tokio::sync::Mutex;

#[derive(Error, Debug)]
#[allow(clippy::enum_variant_names)]
pub enum SenderError {
    #[error("Failed to connect to {1} with error {0}")]
    ConnectionFailedError(std::io::Error, SocketAddr),
    #[error("Failed to send to {1} with error {0}")]
    SendFailedError(std::io::Error, SocketAddr),
}

pub type SendResult = Result<(), SenderError>;

pub struct ShardusNetSender {
    key_pair: crypto::KeyPair,
    send_channel: UnboundedSender<(SocketAddr, Vec<u8>, Sender<SendResult>)>,
    evict_socket_channel: UnboundedSender<SocketAddr>,
}

impl ShardusNetSender {
    pub fn new(key_pair: crypto::KeyPair, connections: Arc<Mutex<dyn ConnectionCache + Send>>) -> Self {
        let (send_channel, send_channel_rx) = unbounded_channel();
        let (evict_socket_channel, evict_socket_channel_rx) = unbounded_channel();

        Self::spawn_sender(send_channel_rx, Arc::clone(&connections));
        Self::spawn_evictor(evict_socket_channel_rx, Arc::clone(&connections));

        Self {
            key_pair,
            send_channel,
            evict_socket_channel,
        }
    }

    // send: send data to a socket address without a header
    pub fn send(&self, address: SocketAddr, data: String, complete_tx: Sender<SendResult>) {
        let data = data.into_bytes();
        self.send_channel
            .send((address, data, complete_tx))
            .expect("Unexpected! Failed to send data to channel. Sender task must have been dropped.");
    }

    // send_with_header: send data to a socket address with a header and signature
    pub fn send_with_header(&self, address: SocketAddr, header_version: u8, mut header: Header, data: Vec<u8>, complete_tx: Sender<SendResult>) {
        let compressed_data = header.compress(data);
        header.set_message_length(compressed_data.len() as u32);
        let serialized_header = header_serialize_factory(header_version, header).expect("Failed to serialize header");
        let message = Message::new_unsigned(header_version, serialized_header, compressed_data);
        let shardus_crypto_instance = shardus_crypto::get_shardus_crypto_instance();
        let serialized_message = message.serialize_optimized(&shardus_crypto_instance, &self.key_pair);
        self.send_channel
            .send((address, serialized_message, complete_tx))
            .expect("Unexpected! Failed to send data with header to channel. Sender task must have been dropped.");
    }

    // multi_send_with_header: send data to multiple socket addresses with a single header and signature
    pub fn multi_send_with_header(&self, addresses: Vec<SocketAddr>, header_version: u8, mut header: Header, data: Vec<u8>, senders: Vec<Sender<SendResult>>) {
        let compressed_data = header.compress(data);
        header.set_message_length(compressed_data.len() as u32);
        let serialized_header = header_serialize_factory(header_version, header).expect("Failed to serialize header");
        let mut message = Message::new_unsigned(header_version, serialized_header.clone(), compressed_data.clone());
        message.sign(shardus_crypto::get_shardus_crypto_instance(), &self.key_pair);
        let serialized_message = wrap_serialized_message(message.serialize());

        for (address, sender) in addresses.into_iter().zip(senders.into_iter()) {
            self.send_channel
                .send((address, serialized_message.clone(), sender))
                .expect("Failed to send data with header to channel");
        }
    }

    pub fn evict_socket(&self, address: SocketAddr) {
        self.evict_socket_channel
            .send(address)
            .expect("Unexpected! Failed to send data to channel. Socket evictor task must have been dropped.");
    }

    fn spawn_evictor(evict_socket_channel_rx: UnboundedReceiver<SocketAddr>, connections: Arc<Mutex<dyn ConnectionCache + Send>>) {
        RUNTIME.spawn(async move {
            let mut evict_socket_channel_rx = evict_socket_channel_rx;

            while let Some(address) = evict_socket_channel_rx.recv().await {
                let mut connections = connections.lock().await;
                connections.remove(&address);
                #[cfg(debug)]
                info!("Evicted socket {} from cache", address);
            }

            #[cfg(debug)]
            info!("Evictor channel complete. Shutting down evictor task.")
        });
    }

    fn spawn_sender(send_channel_rx: UnboundedReceiver<(SocketAddr, Vec<u8>, Sender<SendResult>)>, connections: Arc<Mutex<dyn ConnectionCache + Send>>) {
        RUNTIME.spawn(async move {
            let mut send_channel_rx = send_channel_rx;

            while let Some((address, data, complete_tx)) = send_channel_rx.recv().await {
                let connection = {
                    let mut connections = connections.lock().await;
                    connections.get_or_insert(address)
                };

                RUNTIME.spawn(async move {
                    let timeout_duration = tokio::time::Duration::from_secs(120);
                    let result = match tokio::time::timeout(timeout_duration, connection.send(data)).await {
                        Ok(result) => result,
                        Err(_) => {
                            let error = std::io::Error::new(std::io::ErrorKind::TimedOut, "Send timed out");
                            Err(SenderError::SendFailedError(error, address))
                        }
                    };
                    complete_tx.send(result).ok();
                });
            }

            #[cfg(debug)]
            info!("Sending channel complete. Shutting down sending task.")
        });
    }
}

pub struct Connection {
    address: SocketAddr,
    socket: Mutex<Option<TcpStream>>,
}

impl Connection {
    fn new(address: SocketAddr) -> Self {
        let socket = Mutex::new(None);

        Self { address, socket }
    }

    async fn send(&self, data: Vec<u8>) -> SendResult {
        let mut socket = self.socket.lock().await;
        let socket_op = &mut (*socket);

        let socket = Self::connect_and_set_socket_if_none(socket_op, self.address).await?;

        let result = Self::write_data_to_stream(socket, &data).await;

        if result.is_err() {
            #[cfg(debug)]
            info!("Failed to send data to {}. Attempting to reconnect and try again.", self.address);

            // There was an error sending data. The connection might have been previously closed.
            *socket_op = None;

            // Since there was an error previously, try reconnecting to the socket and resending the data.
            let socket = Self::connect_and_set_socket_if_none(socket_op, self.address).await?;
            let result = Self::write_data_to_stream(socket, &data).await;

            // If there is still an error even after the retry, return as failure to send.
            if let Err(error) = result {
                return Err(SenderError::SendFailedError(error, self.address));
            }
        }

        Ok(())
    }

    async fn connect_and_set_socket_if_none(socket_op: &mut Option<TcpStream>, address: SocketAddr) -> Result<&mut TcpStream, SenderError> {
        let was_socket_none = socket_op.is_none();

        if was_socket_none {
            let connection_stream = TcpStream::connect(address).await;

            match connection_stream {
                Ok(connection_stream) => *socket_op = Some(connection_stream),
                Err(error) => return Err(SenderError::ConnectionFailedError(error, address)),
            }
        }

        let socket = socket_op.as_mut().expect("Unexpected! This socket has already been checked to exist.");

        Ok(socket)
    }

    async fn write_data_to_stream(socket: &mut TcpStream, data: &[u8]) -> io::Result<()> {
        let len = data.len() as u32;
        let len_bytes = len.to_be_bytes();
        
        socket.write_all(&len_bytes).await?;        
        socket.write_all(data).await?;        
        socket.flush().await?;
        
        Ok(())
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        if let Some(mut stream) = self.socket.get_mut().take() {
            RUNTIME.spawn(async move {
                stream.shutdown().await.ok();
            });
        }
    }
}

pub trait ConnectionCache {
    fn get_or_insert(&mut self, address: SocketAddr) -> Arc<Connection>;
    fn remove(&mut self, address: &SocketAddr) -> Option<Arc<Connection>>;
}

impl ConnectionCache for HashMap<SocketAddr, Arc<Connection>> {
    fn get_or_insert(&mut self, address: SocketAddr) -> Arc<Connection> {
        self.entry(address).or_insert_with(|| Arc::new(Connection::new(address))).clone()
    }

    fn remove(&mut self, address: &SocketAddr) -> Option<Arc<Connection>> {
        self.remove(address)
    }
}

impl ConnectionCache for LruCache<SocketAddr, Arc<Connection>> {
    fn get_or_insert(&mut self, address: SocketAddr) -> Arc<Connection> {
        #[cfg(debug)]
        info!("LruCache stats, current_size: {}, capacity: {}", self.len(), self.cap());
        match self.get(&address) {
            Some(connection) => connection.clone(),
            None => {
                let connection = Arc::new(Connection::new(address));
                // `put` used instead of push to avoid memory leak.
                self.put(address, connection.clone());
                connection
            }
        }
    }

    fn remove(&mut self, address: &SocketAddr) -> Option<Arc<Connection>> {
        self.pop(address)
    }
}
