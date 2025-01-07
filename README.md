# shardus-net

A library for sending and receiving JSON messages over raw TCP sockets.

Fundamentally, this is just a networked event emitter. Under the hood, the library is using a UUID system to correlate messages to their response handler in order to facilitate the simulation of a request/response system. Hence, the library can only be used to send data to and from other servers using this library (for now).

## Installation

### Regular Installation
```bash
npm install @shardeum-foundation/lib-net
```

This will automatically download pre-built binaries for your platform if available. If no pre-built binary is available, it will fall back to building from source.

### Development Setup
If you want to build from source or contribute to development:
```bash
# Clone the repository
git clone https://github.com/shardeum/lib-net.git
cd lib-net

# Install dependencies and build
npm install
npm run build
```

### Requirements
- Node.js: Version specified in `.node-version`
- Rust: Version specified in `rust-toolchain.toml`
  - Required components: rustfmt, clippy
  - Required targets: linux, macos, windows

### Build Process
The package includes Rust native modules which are:
- Pre-built for common platforms and attached to GitHub releases
- Automatically downloaded during installation
- Built from source as fallback if no pre-built binary is available

### Build System Architecture
This project uses a modern Rust + Node.js build system:

#### Native Module Building
- Rust code is compiled to a native `.node` module using `cargo`
- `cargo-cp-artifact` handles copying the built `.node` file to the correct location
- No node-gyp is required - the build process is entirely Rust-based
- Development builds use `npm run build-rust` (includes debug symbols)
- Production builds use `npm run build-rust-release` (optimized, no debug symbols)

#### Binary Distribution
- `@mapbox/node-pre-gyp` manages binary distribution and installation
- Pre-built binaries are created for all supported platforms during release
- Binary naming format: `shardus-net-v{version}-{node_abi}-{platform}-{arch}.tar.gz`
- Binaries are automatically published to NPM as part of the release process
- Binary downloads are handled transparently during package installation

#### Installation Flow
1. When installing the package, `node-pre-gyp` attempts to download a pre-built binary:
   ```bash
   node-pre-gyp install --fallback-to-build=false
   ```
   - Checks NPM registry for a matching pre-built binary
   - Binary must match your platform, architecture, and Node.js ABI version
   - We don't use node-pre-gyp's fallback build because it expects node-gyp, while we use a pure Rust build system

2. If a matching binary is found:
   - Downloads and extracts it to the `native/{platform}-{arch}/` directory
   - Installation completes successfully

3. If no binary is found (or download fails):
   - The install script falls back to building just the native module:
     ```bash
     npm run build-rust
     ```
   - This compiles the Rust code and copies the resulting `.node` file to the correct location
   - TypeScript code is pre-compiled in the published package

Note: The full `npm run build` command (which builds both Rust and TypeScript) is only needed during development.

#### Development Workflow
- `npm run build-rust` - Builds only the Rust native module
- `npm run build-node` - Compiles TypeScript code
- `npm run build` - Builds both Rust and TypeScript
- `npm run clean` - Cleans build artifacts and native modules

## Development

### Building
- `npm run build` - Build both TypeScript and Rust code
- `npm run build-node` - Build only TypeScript
- `npm run build-rust` - Build only Rust code
- `npm test` - Run tests

### Creating Releases
Releases are managed through GitHub Actions:
1. New releases are triggered via the GitHub Actions UI
2. Choose the release type:
   - `major` - Breaking changes (1.0.0 -> 2.0.0)
   - `minor` - New features (1.0.0 -> 1.1.0)
   - `patch` - Bug fixes (1.0.0 -> 1.0.1)
   - `prerelease` - Pre-release versions
3. For prereleases:
   - Choose an identifier (default: 'beta'): alpha, beta, rc
   - The workflow automatically handles version incrementing:
     ```
     1.0.0 -> 1.0.1-beta.0  (first beta, automatically detected)
           -> 1.0.1-beta.1  (subsequent beta, automatically detected)
           -> 1.0.1-beta.2  (subsequent beta, automatically detected)
           -> 1.0.1         (stable release)
     ```
   - Published to NPM with the prerelease tag (e.g., `@beta`)
4. The workflow will:
   - Create a new version based on the selected type
   - Build and test the package
   - Generate optimized pre-built binaries for all supported platforms (using --release)
   - Create a GitHub Release (marked as prerelease if applicable)
   - Publish to NPM with appropriate tags

Note: All production binaries (both pre-built and fallback builds) use Rust's release mode (--release flag) for optimal performance.

### Installing Specific Versions
```bash
# Latest stable version
npm install @shardeum-foundation/lib-net

# Latest beta version
npm install @shardeum-foundation/lib-net@beta

# Latest alpha version
npm install @shardeum-foundation/lib-net@alpha

# Specific version
npm install @shardeum-foundation/lib-net@1.0.0-beta.1
```

### Development Tips
- Use `npm install --ignore-scripts` to skip binary builds during installation
- Run `npm run build-rust` when you need to rebuild only the Rust code
- Use `npm run build-node` for TypeScript-only builds
- Run `npm test` to run the test suite

## Usage

### Javascript

```js
const port = 1234
const address = 'localhost'

const sn = require('@shardeum-foundation/lib-net')({ port, address })
```

### Typescript

```ts
import * as ShardusNet from '@shardeum-foundation/lib-net'

const port = 1234
const address = 'localhost'
const sn = ShardusNet.createNetwork({ port, address })
```

### sn.send

```js
// If you want to send a one-way message, not expecting a response:
const destinationPort    = 53
const destinationAddress = 8.8.8.8
const data               = { algebraic: 'Yeah!' }

const protocol = await sn.send(destinationPort, destinationAddress, data)

// Note: the promise returned by sn.send will resolve once the data has been
//       successfully sent, and has nothing to do with a response.

// Now, if you _are_ expecting a response:
const destinationPort    = 53
const destinationAddress = 8.8.8.8
const data               = { mathematical: 'Alright!' }
const timeout            = 10000 // how long to wait for the response (in ms)

// Note: If the timeout is set to 0, the library will assume you're not waiting
//       for a response.

const onResponse = data => console.log(data)
const onTimeout  = () => throw new Error('timed out :(')

// You must be listening in order to receive responses, even if you don't
// do anything with incoming data. In a normal use case, you will already
// have a listener set up and do not need to execute this step.
await sn.listen(() => {})

const protocol = await sn.send(destinationPort, destinationAddress, data, timeout, onResponse, onTimeout)

// Assuming the server you send to bounces back the data (see below for how to do this),
// your console will log: "{ mathematical: 'Alright!' }"
```

### sn.listen

```js
const server = await sn.listen((data, remote, protocol, respond) => {
  // `remote` is an object with { address: <sender's address>, port: <origin port> }
  // Note: The port is of virtually no use -- it represents the port that data was
  //       send _from_, and you cannot send anything back to that port.

  // `data` is of course whatever you've been sent. You've got mail!

  // `respond` is the function you can use to send data back.

  // In this example, we'll use respond to simply bounce back the data we were
  // given. This completes the example from `send` above.
  await respond(data)
})

// You now have access to the "server" object, which contains the lower level
// net server, if you need it.
```

### sn.stopListening

```js
// When you want to spin down your listener, simply call stopListening and pass in
// the server object you were given when you started listening.

await sn.stopListening(servers)
```

## Contributing

Contributions are very welcome! Everyone interacting in our codebases, issue trackers, and any other form of communication, including chat rooms and mailing lists, is expected to follow our [code of conduct](./CODE_OF_CONDUCT.md) so we can all enjoy the effort we put into this project.

Special thanks to Aaron Sullivan (<aasullivan1618@gmail.com>) for the contributions that became the base for this library.
You can find them here at <https://gitlab.com/Shardus/shardus-quic-net.git>
