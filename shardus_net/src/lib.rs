use std::cell::RefCell;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::num::NonZeroUsize;
use std::time::Duration;
use std::time::Instant;
use std::{net::ToSocketAddrs, sync::Arc};

use log::info;
use log::LevelFilter;
use lru::LruCache;
use neon::{prelude::*, result::Throw};

mod ring_buffer;
mod runtime;
mod shardus_net_listener;
mod shardus_net_sender;
mod stats;

use ring_buffer::Stats as RingBufferStats;
use runtime::RUNTIME;
use shardus_net_listener::ShardusNetListener;
use shardus_net_sender::ConnectionCache;
use shardus_net_sender::{SendResult, ShardusNetSender};
use simplelog::{Config, SimpleLogger};
use stats::{Incrementers, Stats, StatsResult};
use tokio::sync::oneshot;
use tokio::sync::Mutex;

// extern crate parse_core; //this fails too
// use parse_core;

//use bespoke_binary::get_hello_message;
use parse_core::get_hello_message;

// fn main() {
//     let hello_message = get_hello_message();
//     println!("{}", hello_message);
// }

use crate::shardus_net_sender::Connection;

fn create_shardus_net(mut cx: FunctionContext) -> JsResult<JsObject> {
    let cx = &mut cx;

    // Extract args
    let port = cx.argument::<JsNumber>(0)?.value(cx);
    let host = cx.argument::<JsString>(1)?.value(cx);
    let use_lru = cx.argument::<JsBoolean>(2)?.value(cx);
    let lru_size = cx.argument::<JsNumber>(3)?.value(cx);

    let shardus_net_listener = create_shardus_net_listener(cx, port, host)?;
    let shardus_net_sender = create_shardus_net_sender(use_lru, NonZeroUsize::new(lru_size as usize).unwrap());
    let (stats, stats_incrementers) = Stats::new();
    let shardus_net_listener = cx.boxed(shardus_net_listener);
    let shardus_net_sender = cx.boxed(shardus_net_sender);
    let stats = cx.boxed(RefCell::new(stats));
    let stats_incrementers = cx.boxed(stats_incrementers);

    let shardus_net = cx.empty_object();

    let listen = JsFunction::new(cx, listen)?;
    let send = JsFunction::new(cx, send)?;
    let get_stats = JsFunction::new(cx, get_stats)?;
    let evict_socket = JsFunction::new(cx, evict_socket)?;

    shardus_net.set(cx, "_listener", shardus_net_listener)?;
    shardus_net.set(cx, "_sender", shardus_net_sender)?;
    shardus_net.set(cx, "_stats", stats)?;
    shardus_net.set(cx, "_stats_incrementers", stats_incrementers)?;
    shardus_net.set(cx, "listen", listen)?;
    shardus_net.set(cx, "send", send)?;
    shardus_net.set(cx, "evict_socket", evict_socket)?;
    shardus_net.set(cx, "stats", get_stats)?;

    let hello_message = get_hello_message();
    println!("{}", hello_message);

    Ok(shardus_net)
}

fn listen(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let cx = &mut cx;
    let callback = cx.argument::<JsFunction>(0)?.root(cx);
    let shardus_net_listener = cx.this().get(cx, "_listener")?.downcast_or_throw::<JsBox<Arc<ShardusNetListener>>, _>(cx)?;
    let stats_incrementers = cx.this().get(cx, "_stats_incrementers")?.downcast_or_throw::<JsBox<Incrementers>, _>(cx)?;
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
        while let Some((msg, remote_address)) = rx.recv().await {
            let callback = callback.clone();
            let this = this.clone();
            let channel = channel.clone();

            stats_incrementers.increment_outstanding_receives();

            RUNTIME.spawn_blocking(move || {
                let now = Instant::now();
                channel.send(move |mut cx| {
                    let cx = &mut cx;

                    let elapsed = now.elapsed();
                    let stats = this.to_inner(cx).get(cx, "_stats")?.downcast_or_throw::<JsBox<RefCell<Stats>>, _>(cx)?;
                    let mut stats = (**stats).borrow_mut();

                    stats.decrement_outstanding_receives();
                    stats.put_elapsed_receive(elapsed);

                    drop(stats);

                    let this = cx.undefined();
                    let message = cx.string(msg);
                    let remote_ip = cx.string(remote_address.ip().to_string());
                    let remote_port = cx.number(remote_address.port());
                    let args: [Handle<JsValue>; 3] = [message.upcast(), remote_ip.upcast(), remote_port.upcast()];

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
    let shardus_net_sender = cx.this().get(cx, "_sender")?.downcast_or_throw::<JsBox<Arc<ShardusNetSender>>, _>(cx)?;
    let stats_incrementers = cx.this().get(cx, "_stats_incrementers")?.downcast_or_throw::<JsBox<Incrementers>, _>(cx)?;

    let this = cx.this().root(cx);
    let channel = cx.channel();
    let (complete_tx, complete_rx) = oneshot::channel::<SendResult>();

    stats_incrementers.increment_outstanding_sends();

    RUNTIME.spawn(async move {
        let result = complete_rx.await.expect("Complete send tx dropped before notify");

        RUNTIME.spawn_blocking(move || {
            channel.send(move |mut cx| {
                let cx = &mut cx;
                let stats = this.to_inner(cx).get(cx, "_stats")?.downcast_or_throw::<JsBox<RefCell<Stats>>, _>(cx)?;
                (**stats).borrow_mut().decrement_outstanding_sends();

                let this = cx.undefined();
                let mut args = Vec::new();

                if let Err(err) = result {
                    let error = cx.string(format!("{:?}", err));
                    args.push(error);
                }

                complete_cb.to_inner(cx).call(cx, this, args)?;

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

fn get_stats(mut cx: FunctionContext) -> JsResult<JsObject> {
    let cx = &mut cx;
    let stats = cx.this().get(cx, "_stats")?.downcast_or_throw::<JsBox<RefCell<Stats>>, _>(cx)?;
    let stats = (**stats).borrow_mut().get_stats();
    let stats = stats.to_object(cx)?;

    Ok(stats)
}

fn evict_socket(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let cx = &mut cx;
    let port = cx.argument::<JsNumber>(0)?.value(cx);
    let host = cx.argument::<JsString>(1)?.value(cx);
    let shardus_net_sender = cx.this().get(cx, "_sender")?.downcast_or_throw::<JsBox<Arc<ShardusNetSender>>, _>(cx)?;

    match (host, port as u16).to_socket_addrs() {
        Ok(mut address) => {
            let address = address.next().expect("Expected at least one address");

            shardus_net_sender.evict_socket(address);

            Ok(cx.undefined())
        }
        Err(_) => cx.throw_type_error("The provided address is not valid"),
    }
}

fn create_shardus_net_listener(cx: &mut FunctionContext, port: f64, host: String) -> Result<Arc<ShardusNetListener>, Throw> {
    // @TODO: Verify that a javascript number properly converts here without loss.
    let address = (host, port as u16);

    let shardus_net = ShardusNetListener::new(address);

    match shardus_net {
        Ok(net) => Ok(Arc::new(net)),
        Err(_) => cx.throw_type_error("The provided address is not valid")?,
    }
}

fn create_shardus_net_sender(use_lru: bool, lru_size: NonZeroUsize) -> Arc<ShardusNetSender> {
    let connections: Arc<Mutex<dyn ConnectionCache + Send>> = if use_lru {
        info!("Using LRU cache with size {} for socket mgmt", lru_size.get());
        Arc::new(Mutex::new(LruCache::new(lru_size)))
    } else {
        info!("Using hashmap for socket mgmt");
        Arc::new(Mutex::new(HashMap::<SocketAddr, Arc<Connection>>::new()))
    };

    Arc::new(ShardusNetSender::new(connections))
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

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    let hello_message = get_hello_message();
    println!("2 {}", hello_message);

    let hello2 = bespoke_binary::get_hello_message();
    println!("3 {}", hello2);

    SimpleLogger::init(LevelFilter::Info, Config::default()).unwrap();

    cx.export_function("Sn", create_shardus_net)?;

    Ok(())
}