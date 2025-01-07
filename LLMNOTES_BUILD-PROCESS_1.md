# Build Process Notes

## Project Structure
- TypeScript/Node.js project with Rust native modules
- Uses cargo-cp-artifact (dev dependency) for Rust artifact management
- Rust code in multiple directories: shardus_net, crypto, shardeum_utils

## Build Tools
- cargo-cp-artifact: Copies Rust compiled artifacts to Node.js native module location
- node-pre-gyp: Manages binary distribution and installation
- TypeScript compiler: Builds Node.js code

## Build Configuration
- Main build script: `npm run build`
  - Runs `build-rust-release` followed by `build-node`
- Rust build happens on:
  - postinstall (fallback)
  - prepare
  - build
- Uses cargo-cp-artifact to compile Rust to native Node modules

## Performance Impact Points
1. Rust compilation during npm install (postinstall)
2. Debug vs Release builds
3. Multiple Rust crates/directories
4. No caching mechanism identified yet

## Potential Optimization Areas
1. Cache Rust builds
2. Use pre-built binaries
3. Optimize Rust compilation flags
4. Separate dev/prod dependencies 