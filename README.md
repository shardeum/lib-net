# shardus-net

A library for sending and receiving JSON messages over raw TCP sockets.

Fundamentally, this is just a networked event emitter. Under the hood, the library is using a UUID system to correlate messages to their response handler in order to facilitate the simulation of a request/response system. Hence, the library can only be used to send data to and from other servers using this library (for now).

## Installation

You can install shardus net via npm:

```sh
npm i gitlab:shardus/shardus-net
```

## Local Development

If you're working on the `shardus-net` package, make sure to run the command `npm run build` manually to ensure both TypeScript and Rust files are generated.

For publishing a release to NPM, simply run `npm run release` command.

## Usage

### Javascript

```js
const port = 1234
const address = 'localhost'

const sn = require('shardus-net')({ port, address })
```

### Typescript

```ts
import * as ShardusNet from 'shardus-net'

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
