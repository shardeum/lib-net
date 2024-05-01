use std::sync::Once;
use crypto::ShardusCrypto;
use once_cell::sync::OnceCell;

static SHARDUS_CRYPTO_INSTANCE: OnceCell<ShardusCrypto> = OnceCell::new();
static INIT: Once = Once::new();

// Initialize the ShardusCrypto instance exactly once
pub fn initialize_shardus_crypto_instance(hex_key: &str) {
    INIT.call_once(|| {
        let crypto = ShardusCrypto::new(hex_key);
        // Attempt to set the OnceCell, which should never fail since it's guarded by `INIT.call_once()`
        if SHARDUS_CRYPTO_INSTANCE.set(crypto).is_err() {
            panic!("ShardusCrypto instance has already been initialized, this should never happen");
        }
    });
}

// Get a reference to the initialized ShardusCrypto instance
pub fn get_shardus_crypto_instance() -> &'static ShardusCrypto {
    SHARDUS_CRYPTO_INSTANCE.get().expect("ShardusCrypto instance not initialized")
}
