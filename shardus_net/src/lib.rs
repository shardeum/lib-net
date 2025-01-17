#![deny(warnings)]
use std::cell::RefCell;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::num::NonZeroUsize;
use std::time::Duration;
use std::time::Instant;
use std::{net::ToSocketAddrs, sync::Arc};

use header_factory::header_from_json_string;
#[cfg(debug)]
use log::info;
//use log::LevelFilter;
use lru::LruCache;
use neon::{prelude::*, result::Throw};

mod message;
mod ring_buffer;
mod runtime;
mod shardus_crypto;
mod shardus_net_listener;
mod shardus_net_sender;
mod stats;

pub mod compression;
pub mod header;
mod header_factory;

use ring_buffer::Stats as RingBufferStats;
use runtime::RUNTIME;
use shardus_net_listener::ShardusNetListener;
use shardus_net_sender::ConnectionCache;
use shardus_net_sender::{SendResult, ShardusNetSender};
use stats::{Incrementers, Stats, StatsResult};
use tokio::sync::oneshot;
use tokio::sync::Mutex;

use crate::shardus_net_sender::Connection;

const ENABLE_COMPRESSION: bool = false;

#[derive(Copy, Clone)]
pub struct NetConfig {
    pub header_size_limit: usize,
    pub payload_size_limit: usize,
}
const SIGNATURE_SIZE_LIMIT_IN_BYTES: usize = 96;
const OWNER_SIZE_LIMIT_IN_BYTES: usize = 32;

fn create_shardus_net(mut cx: FunctionContext) -> JsResult<JsObject> {
    let cx = &mut cx;

    // Extract args
    let port = cx.argument::<JsNumber>(0)?.value(cx);
    let host = cx.argument::<JsString>(1)?.value(cx);
    let use_lru = cx.argument::<JsBoolean>(2)?.value(cx);
    let lru_size = cx.argument::<JsNumber>(3)?.value(cx);
    let hash_key = cx.argument::<JsString>(4)?.value(cx);
    let hex_signing_sk = cx.argument::<JsString>(5)?.value(cx);
    let payload_size_limit = cx.argument::<JsNumber>(6)?.value(cx) as usize;
    let header_size_limit = cx.argument::<JsNumber>(7)?.value(cx) as usize;

    let net_config = NetConfig {
        header_size_limit,
        payload_size_limit,
    };

    shardus_crypto::initialize_shardus_crypto_instance(&hash_key);

    let key_pair = shardus_crypto::get_shardus_crypto_instance().get_key_pair_using_sk(&crypto::HexStringOrBuffer::Hex(hex_signing_sk));
    let shardus_net_listener = create_shardus_net_listener(cx, port, host, net_config)?;
    let shardus_net_sender = create_shardus_net_sender(use_lru, NonZeroUsize::new(lru_size as usize).unwrap(), key_pair);
    let (stats, stats_incrementers) = Stats::new();
    let shardus_net_listener = cx.boxed(shardus_net_listener);
    let shardus_net_sender = cx.boxed(shardus_net_sender);
    let stats = cx.boxed(RefCell::new(stats));
    let stats_incrementers = cx.boxed(stats_incrementers);

    let shardus_net = cx.empty_object();

    let listen = JsFunction::new(cx, listen)?;
    let send = JsFunction::new(cx, send)?;
    let send_with_header = JsFunction::new(cx, send_with_header)?;
    let multi_send_with_header = JsFunction::new(cx, multi_send_with_header)?;
    let get_stats: Handle<'_, JsFunction> = JsFunction::new(cx, get_stats)?;
    let evict_socket = JsFunction::new(cx, evict_socket)?;

    shardus_net.set(cx, "_listener", shardus_net_listener)?;
    shardus_net.set(cx, "_sender", shardus_net_sender)?;
    shardus_net.set(cx, "_stats", stats)?;
    shardus_net.set(cx, "_stats_incrementers", stats_incrementers)?;
    shardus_net.set(cx, "listen", listen)?;
    shardus_net.set(cx, "send", send)?;
    shardus_net.set(cx, "send_with_header", send_with_header)?;
    shardus_net.set(cx, "multi_send_with_header", multi_send_with_header)?;
    shardus_net.set(cx, "evict_socket", evict_socket)?;
    shardus_net.set(cx, "stats", get_stats)?;

    Ok(shardus_net)
}

fn listen(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let cx = &mut cx;
    let callback = cx.argument::<JsFunction>(0)?.root(cx);
    let shardus_net_listener = cx.this().get::<JsBox<Arc<ShardusNetListener>>, _, _>(cx, "_listener")?;
    let stats_incrementers = cx.this().get::<JsBox<Incrementers>, _, _>(cx, "_stats_incrementers")?;
    let stats_incrementers = (**stats_incrementers).clone();
    let this = cx.this().root(cx);

    let shardus_net_listener = (**shardus_net_listener).clone();
    let channel = cx.channel();

    RUNTIME.spawn(async move {
        let mut rx = shardus_net_listener.listen();
        let callback = Arc::new(callback);
        let this = Arc::new(this);

        // rx is the UnboundedReceiver<(String, SocketAddr)> that is returned from listen.
        // all received messages are sent to the UnboundedSender.  here we call recv to
        // get messages from the UnboundedReceiver.  recv is a blocking call
        while let Some((msg, remote_address, optional_request_metadata)) = rx.recv().await {
            let callback = callback.clone();
            let this = this.clone();
            let channel = channel.clone();

            stats_incrementers.increment_outstanding_receives();

            RUNTIME.spawn_blocking(move || {
                let now = Instant::now();
                channel.send(move |mut cx| {
                    let cx = &mut cx;

                    let elapsed = now.elapsed();
                    let stats = this.to_inner(cx).get::<JsBox<RefCell<Stats>>, _, _>(cx, "_stats")?;
                    let mut stats = (**stats).borrow_mut();

                    stats.decrement_outstanding_receives();
                    stats.put_elapsed_receive(elapsed);

                    drop(stats);

                    let this = cx.undefined();
                    let message = cx.string(msg);
                    let remote_ip = cx.string(remote_address.ip().to_string());
                    let remote_port = cx.number(remote_address.port());
                    let optional_header_version: neon::handle::Handle<'_, neon::prelude::JsValue> = match &optional_request_metadata {
                        Some(request_metadata) => cx.number(request_metadata.version as f64).upcast(),
                        None => cx.null().upcast(),
                    };

                    let optional_header_json_string: neon::handle::Handle<'_, neon::prelude::JsValue> = match &optional_request_metadata {
                        Some(request_metadata) => cx.string(&request_metadata.header_json_string).upcast(),
                        None => cx.null().upcast(),
                    };

                    let optional_sign_json_string: neon::handle::Handle<'_, neon::prelude::JsValue> = match &optional_request_metadata {
                        Some(request_metadata) => cx.string(&request_metadata.sign_json_string).upcast(),
                        None => cx.null().upcast(),
                    };

                    let args: [Handle<JsValue>; 6] = [
                        message.upcast(),
                        remote_ip.upcast(),
                        remote_port.upcast(),
                        optional_header_version,
                        optional_header_json_string,
                        optional_sign_json_string,
                    ];

                    callback.to_inner(cx).call(cx, this, args)?;

                    Ok(())
                });
            });
        }
    });

    Ok(cx.undefined())
}

fn send(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let cx = &mut cx;
    let port = cx.argument::<JsNumber>(0)?.value(cx);
    let host = cx.argument::<JsString>(1)?.value(cx);
    let data = cx.argument::<JsString>(2)?.value(cx);
    let complete_cb = cx.argument::<JsFunction>(3)?.root(cx);
    let shardus_net_sender = cx.this().get::<JsBox<Arc<ShardusNetSender>>, _, _>(cx, "_sender")?;
    let stats_incrementers = cx.this().get::<JsBox<Incrementers>, _, _>(cx, "_stats_incrementers")?;

    let this = cx.this().root(cx);
    let channel = cx.channel();
    let (complete_tx, complete_rx) = oneshot::channel::<SendResult>();

    stats_incrementers.increment_outstanding_sends();

    RUNTIME.spawn(async move {
        let result = complete_rx.await.expect("Complete send tx dropped before notify");

        RUNTIME.spawn_blocking(move || {
            channel.send(move |mut cx| {
                let cx = &mut cx;
                let stats = this.to_inner(cx).get::<JsBox<RefCell<Stats>>, _, _>(cx, "_stats")?;
                (**stats).borrow_mut().decrement_outstanding_sends();

                let this = cx.undefined();

                if let Err(err) = result {
                    let error = cx.string(format!("{:?}", err));
                    complete_cb.to_inner(cx).call(cx, this, [error.upcast()])?;
                } else {
                    complete_cb.to_inner(cx).call(cx, this, [])?;
                }

                Ok(())
            });
        });
    });

    match (host, port as u16).to_socket_addrs() {
        Ok(mut address) => {
            let address = address.next().expect("Expected at least one address");
            shardus_net_sender.send(address, data, complete_tx);

            Ok(cx.undefined())
        }
        Err(_) => cx.throw_type_error("The provided address is not valid"),
    }
}

pub fn send_with_header(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let cx = &mut cx;
    let port: u16 = cx.argument::<JsNumber>(0)?.value(cx) as u16;
    let host: String = cx.argument::<JsString>(1)?.value(cx) as String;
    let header_version: u8 = cx.argument::<JsNumber>(2)?.value(cx) as u8;
    let header_js_string: String = cx.argument::<JsString>(3)?.value(cx) as String;
    let data_js_string: String = cx.argument::<JsString>(4)?.value(cx) as String;
    let complete_cb = cx.argument::<JsFunction>(5)?.root(cx);

    let shardus_net_sender = cx.this().get::<JsBox<Arc<ShardusNetSender>>, _, _>(cx, "_sender")?;
    let stats_incrementers = cx.this().get::<JsBox<Incrementers>, _, _>(cx, "_stats_incrementers")?;

    let this = cx.this().root(cx);
    let channel = cx.channel();
    let (complete_tx, complete_rx) = oneshot::channel::<SendResult>();

    stats_incrementers.increment_outstanding_sends();

    let header = match header_from_json_string(&header_js_string, &header_version) {
        Some(header) => header,
        None => {
            // Throw a JavaScript error if header is None
            return cx.throw_error("Failed to parse header");
        }
    };

    let data = data_js_string.into_bytes().to_vec();

    RUNTIME.spawn(async move {
        let result = complete_rx.await.expect("Complete send tx dropped before notify");

        RUNTIME.spawn_blocking(move || {
            channel.send(move |mut cx| {
                let cx = &mut cx;
                let stats = this.to_inner(cx).get::<JsBox<RefCell<Stats>>, _, _>(cx, "_stats")?;
                (**stats).borrow_mut().decrement_outstanding_sends();

                let this = cx.undefined();

                if let Err(err) = result {
                    let error = cx.string(format!("{:?}", err));
                    complete_cb.to_inner(cx).call(cx, this, [error.upcast()])?;
                } else {
                    complete_cb.to_inner(cx).call(cx, this, [])?;
                }

                Ok(())
            });
        });
    });

    match (host, port).to_socket_addrs() {
        Ok(mut address) => {
            let address = address.next().expect("Expected at least one address");
            shardus_net_sender.send_with_header(address, header_version, header, data, complete_tx);

            Ok(cx.undefined())
        }
        Err(_) => cx.throw_type_error("The provided address is not valid"),
    }
}

pub fn multi_send_with_header(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let cx = &mut cx;

    let ports_js_array = cx.argument::<JsArray>(0)?;
    let ports_result: NeonResult<Vec<u16>> = ports_js_array
        .to_vec(cx)?
        .iter()
        .map(|val| val.downcast::<JsNumber, _>(cx).or_throw(cx).map(|js_number| js_number.value(cx) as u16))
        .collect(); // Collects into a Result<Vec<u16>, _>
    let ports = ports_result?; // Handle error or unwrap the result

    // Convert the JavaScript array of hosts to a Vec<String> in Rust
    let hosts_js_array = cx.argument::<JsArray>(1)?;
    let hosts_result: NeonResult<Vec<String>> = hosts_js_array
        .to_vec(cx)?
        .iter()
        .map(|val| val.downcast::<JsString, _>(cx).or_throw(cx).map(|js_string| js_string.value(cx)))
        .collect(); // Collects into a Result<Vec<String>, _>
    let hosts = hosts_result?; // Handle error or unwrap the result

    let header_version: u8 = cx.argument::<JsNumber>(2)?.value(cx) as u8;
    let header_js_string: String = cx.argument::<JsString>(3)?.value(cx) as String;
    let data_js_string: String = cx.argument::<JsString>(4)?.value(cx) as String;
    let complete_cb = cx.argument::<JsFunction>(5)?.root(cx);
    let await_processing = cx.argument::<JsBoolean>(6)?.value(cx); // this flag lets us skip the processing on the stats and the callback

    let shardus_net_sender = cx.this().get::<JsBox<Arc<ShardusNetSender>>, _, _>(cx, "_sender")?;
    let stats_incrementers = cx.this().get::<JsBox<Incrementers>, _, _>(cx, "_stats_incrementers")?;

    let this = cx.this().root(cx);
    let channel = cx.channel();

    for _ in 0..ports.len() {
        stats_incrementers.increment_outstanding_sends();
    }

    let header = match header_from_json_string(&header_js_string, &header_version) {
        Some(header) => header,
        None => {
            // Throw a JavaScript error if header is None
            return cx.throw_error("Failed to parse header");
        }
    };

    let data = data_js_string.into_bytes().to_vec();

    // Create oneshot channels for each host-port pair
    let mut senders = Vec::with_capacity(hosts.len());
    let mut receivers = Vec::with_capacity(hosts.len());

    // should a check be added to see if ports.len == hosts.len
    for _ in 0..hosts.len() {
        let (sender, receiver) = oneshot::channel::<SendResult>();
        senders.push(sender);
        receivers.push(receiver);
    }

    let complete_cb = Arc::new(complete_cb);
    let this = Arc::new(this);

    // Handle the responses asynchronously
    for receiver in receivers {
        let channel = channel.clone();
        let complete_cb = complete_cb.clone();
        let this = this.clone();

        RUNTIME.spawn(async move {
            let result = receiver.await.expect("Complete send tx dropped before notify");

            if await_processing {
                RUNTIME.spawn_blocking(move || {
                    channel.send(move |mut cx| {
                        let cx = &mut cx;
                        let stats = this.to_inner(cx).get::<JsBox<RefCell<Stats>>, _, _>(cx, "_stats")?;
                        (**stats).borrow_mut().decrement_outstanding_sends();

                        let this = cx.undefined();

                        if let Err(err) = result {
                            let error = cx.string(format!("{:?}", err));
                            complete_cb.to_inner(cx).call(cx, this, [error.upcast()])?;
                        } else {
                            complete_cb.to_inner(cx).call(cx, this, [])?;
                        }

                        Ok(())
                    });
                });
            }
        });
    }

    let mut addresses = Vec::new();
    for (host, port) in hosts.iter().zip(ports.iter()) {
        match (host as &str, *port).to_socket_addrs() {
            Ok(mut addr_iter) => {
                let address = addr_iter.next().expect("Expected at least one address");
                addresses.push(address);
            }
            Err(_) => return cx.throw_type_error(format!("The provided address {}:{} is not valid", host, port)),
        }
    }

    if addresses.is_empty() {
        return cx.throw_type_error("No valid addresses provided");
    }

    // Send each address with its corresponding sender
    shardus_net_sender.multi_send_with_header(addresses, header_version, header, data, senders);

    Ok(cx.undefined())
}

fn get_stats(mut cx: FunctionContext) -> JsResult<JsObject> {
    let cx = &mut cx;
    let stats = cx.this().get::<JsBox<RefCell<Stats>>, _, _>(cx, "_stats")?;
    let stats = (**stats).borrow_mut().get_stats();
    let stats = stats.to_object(cx)?;

    Ok(stats)
}

fn evict_socket(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let cx = &mut cx;
    let port = cx.argument::<JsNumber>(0)?.value(cx);
    let host = cx.argument::<JsString>(1)?.value(cx);
    let shardus_net_sender = cx.this().get::<JsBox<Arc<ShardusNetSender>>, _, _>(cx, "_sender")?;

    match (host, port as u16).to_socket_addrs() {
        Ok(mut address) => {
            let address = address.next().expect("Expected at least one address");

            shardus_net_sender.evict_socket(address);

            Ok(cx.undefined())
        }
        Err(_) => cx.throw_type_error("The provided address is not valid"),
    }
}

fn create_shardus_net_listener(cx: &mut FunctionContext, port: f64, host: String, net_config: NetConfig) -> Result<Arc<ShardusNetListener>, Throw> {
    // @TODO: Verify that a javascript number properly converts here without loss.
    let address = (host, port as u16);

    let shardus_net = ShardusNetListener::new(address, net_config);

    match shardus_net {
        Ok(net) => Ok(Arc::new(net)),
        Err(_) => cx.throw_type_error("The provided address is not valid")?,
    }
}

fn create_shardus_net_sender(use_lru: bool, lru_size: NonZeroUsize, key_pair: crypto::KeyPair) -> Arc<ShardusNetSender> {
    let connections: Arc<Mutex<dyn ConnectionCache + Send>> = if use_lru {
        #[cfg(debug)]
        info!("Using LRU cache with size {} for socket mgmt", lru_size.get());
        Arc::new(Mutex::new(LruCache::new(lru_size)))
    } else {
        #[cfg(debug)]
        info!("Using hashmap for socket mgmt");
        Arc::new(Mutex::new(HashMap::<SocketAddr, Arc<Connection>>::new()))
    };

    Arc::new(ShardusNetSender::new(key_pair, connections))
}

impl Finalize for ShardusNetListener {}
impl Finalize for ShardusNetSender {}
impl Finalize for Stats {}
impl Finalize for Incrementers {}

impl StatsResult {
    fn to_object<'a>(&self, cx: &mut impl Context<'a>) -> JsResult<'a, JsObject> {
        let StatsResult {
            outstanding_sends,
            outstanding_receives,
            receive_elapsed,
        } = self;

        let obj = cx.empty_object();

        let outstanding_receives = outstanding_receives.to_object(cx)?;
        obj.set(cx, "outstanding_receives", outstanding_receives)?;

        let outstanding_sends = outstanding_sends.to_object(cx)?;
        obj.set(cx, "outstanding_sends", outstanding_sends)?;

        let receive_elapsed = receive_elapsed.to_object(cx)?;
        obj.set(cx, "receive_elapsed", receive_elapsed)?;

        Ok(obj)
    }
}

impl RingBufferStats<usize> {
    fn to_object<'a>(&self, cx: &mut impl Context<'a>) -> JsResult<'a, JsObject> {
        to_stats_object(
            cx,
            self.long_term_max as f64,
            self.long_term_min as f64,
            self.min as f64,
            self.max as f64,
            self.total as f64,
            self.count,
        )
    }
}

impl RingBufferStats<Duration> {
    fn to_object<'a>(&self, cx: &mut impl Context<'a>) -> JsResult<'a, JsObject> {
        to_stats_object(
            cx,
            self.long_term_max.as_millis() as f64,
            self.long_term_min.as_millis() as f64,
            self.min.as_millis() as f64,
            self.max.as_millis() as f64,
            self.total.as_millis() as f64,
            self.count,
        )
    }
}

fn to_stats_object<'a>(cx: &mut impl Context<'a>, long_term_max: f64, long_term_min: f64, min: f64, max: f64, total: f64, count: usize) -> JsResult<'a, JsObject> {
    let obj = cx.empty_object();

    let long_term_max = cx.number(long_term_max);
    obj.set(cx, "long_term_max", long_term_max)?;

    let long_term_min = cx.number(long_term_min);
    obj.set(cx, "long_term_min", long_term_min)?;

    let min = cx.number(min);
    obj.set(cx, "min", min)?;

    let max = cx.number(max);
    obj.set(cx, "max", max)?;

    let total_num = cx.number(total);
    obj.set(cx, "total", total_num)?;

    let count_num = cx.number(count as f64);
    obj.set(cx, "count", count_num)?;

    let average = if count > 0 { total / count as f64 } else { 0f64 };
    let average = cx.number(average);
    obj.set(cx, "average", average)?;

    Ok(obj)
}

fn set_logging_enabled(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let enabled = cx.argument::<JsBoolean>(0)?.value(&mut cx);

    if enabled {
        log::set_max_level(log::LevelFilter::Info);
    } else {
        log::set_max_level(log::LevelFilter::Off);
    }
    Ok(cx.undefined())
}

fn get_sender_address(mut cx: FunctionContext) -> JsResult<JsObject> {
    let cx = &mut cx;
    let raw_tx = cx.argument::<JsString>(0)?.value(cx);
    let tx = shardeum_utils::get_transaction(&raw_tx);
    let typed_tx = shardeum_utils::get_typed_transaction(&tx);

    let sighash = typed_tx.sighash();
    let v = tx.v.as_u64();
    let r = tx.r;
    let s = tx.s;

    // None is for legacy transactions
    // Some(1,2,3) is for post EIP-2718 transactions
    // They hash things differently than legacy and chainid is integrated into v.
    let pubkey = match tx.transaction_type {
        Some(_) => shardeum_utils::ecrecover(sighash, v + 27, r, s, None).unwrap(),
        None => shardeum_utils::ecrecover(sighash, v, r, s, tx.chain_id).unwrap(),
    };

    let (addr, is_valid) = shardeum_utils::pub_to_addr(pubkey);

    let result = cx.empty_object();
    let js_addr = cx.string(format!("{:?}", addr));

    let base_fee = shardeum_utils::get_base_fee(&typed_tx);
    let binding_fee = shardeum_utils::zero_bigint();
    let gas_limit = typed_tx.gas().unwrap_or(&binding_fee);

    // this has to be upperbound inclusive
    let gas_valid = gas_limit.ge(&base_fee);

    let js_is_valid = cx.boolean(is_valid & gas_valid);
    let js_gas_valid = cx.boolean(gas_valid);
    result.set(cx, "address", js_addr)?;
    result.set(cx, "isValid", js_is_valid)?;
    result.set(cx, "gasValid", js_gas_valid)?;

    Ok(result)
}

fn check_variable_size(variable_len: u32, buffer_size_limit: usize) {
    if variable_len as usize > buffer_size_limit {
        panic!("variable_len : {} exceeds the limit of {} bytes", variable_len, buffer_size_limit);
    }
    // Continue with the flow if the variable is under the limit
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("Sn", create_shardus_net)?;

    cx.export_function("setLoggingEnabled", set_logging_enabled)?;

    cx.export_function("getSenderAddress", get_sender_address)?;

    Ok(())
}
