import { Sn } from '../.'

// Test constants

const NUMBER_OF_SOCKET_CLIENTS = 256 // Unique socket clients to be used for the bombardment
const STARTING_PORT = 49153
const NUMBER_OF_BOMBS = 10 // Number of socket bombs to be sent per socket client (-1 for infinite)
const TARGET_SOCKET_HOST = '127.0.0.1' // Internal host of the validator to be bombarded
const TARGET_SOCKET_PORT = 49152 // Internal port of the validator to be bombarded
const MESSAGE_JSON = { route: 'bombardment-test', payload: 'Hello, world!' } // Message to be sent to the validator
const RAMP_UP_STRATEGY: 'linear' | 'none' = 'none' // Ramp up strategy to be used for the bombardment
const RAMP_UP_EVERY_X_BOMBS = 10 // Number of bombs to be sent before ramping up the number of socket clients

// Test variables

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const socketClients: any[] = []
const metrics = {
  successfulSends: 0,
  failedSends: 0,
}

// Setup helpers

function setupSocketClients() {
  for (let i = 0; i < NUMBER_OF_SOCKET_CLIENTS; i++) {
    const port = STARTING_PORT + i
    socketClients.push(
      Sn({
        port,
        crypto: {
          signingSecretKeyHex:
            'c3774b92cc8850fb4026b073081290b82cab3c0f66cac250b4d710ee9aaf83ed8088b37f6f458104515ae18c2a05bde890199322f62ab5114d20c77bde5e6c9d',
          hashKey: '69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc',
        },
      })
    )
  }
  console.log(`Socket clients created: ${socketClients.length}`)
}

// Test helpers

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Tests

async function socketBombardment() {
  setupSocketClients()
  await delay(3000)

  for (let i = 0; i < NUMBER_OF_BOMBS; i++) {
    const promises: Promise<void>[] = []
    const baseSocketClients = Math.floor(NUMBER_OF_SOCKET_CLIENTS / RAMP_UP_EVERY_X_BOMBS)
    console.log(`Bombardment ${i + 1} of ${NUMBER_OF_BOMBS}`)
    let socketClientsToUse = NUMBER_OF_SOCKET_CLIENTS
    if (RAMP_UP_STRATEGY === 'linear' && i % RAMP_UP_EVERY_X_BOMBS === 0) {
      console.log(
        `Ramping up socket clients from ${socketClientsToUse} to ${
          baseSocketClients * Math.floor(i / RAMP_UP_EVERY_X_BOMBS)
        }`
      )
      socketClientsToUse = baseSocketClients * Math.floor(i / RAMP_UP_EVERY_X_BOMBS)
      if (socketClientsToUse > NUMBER_OF_SOCKET_CLIENTS) socketClientsToUse = NUMBER_OF_SOCKET_CLIENTS
    }
    for (let j = 0; j < socketClientsToUse; j++) {
      // console.log(`Sending message ${j + 1} of ${NUMBER_OF_SOCKET_CLIENTS}`)
      // eslint-disable-next-line security/detect-object-injection
      promises.push(
        // eslint-disable-next-line security/detect-object-injection
        socketClients[j]
          .send(TARGET_SOCKET_PORT, TARGET_SOCKET_HOST, MESSAGE_JSON)
          .catch((err) => console.error(`Bombardment ${i + 1} of ${NUMBER_OF_BOMBS} failed. Error: ${err}`))
      )
    }
    await Promise.all(promises)
  }
}

async function socketBombardmentWithLimitedActiveSockets(numberOfActiveSockets: number) {
  setupSocketClients()
  await delay(3000)

  for (let i = 0; i < NUMBER_OF_BOMBS; i++) {
    const promises: (() => Promise<void>)[] = []
    console.log(`Bombardment ${i + 1} of ${NUMBER_OF_BOMBS}`)
    let socketClientsToUse = NUMBER_OF_SOCKET_CLIENTS
    if (i != 0) socketClientsToUse = numberOfActiveSockets
    for (let j = 0; j < socketClientsToUse; j++) {
      // eslint-disable-next-line security/detect-object-injection
      promises.push(() => {
        console.log(`Sending message ${j + 1} of ${socketClientsToUse}`)
        // eslint-disable-next-line security/detect-object-injection
        return socketClients[j]
          .send(TARGET_SOCKET_PORT, TARGET_SOCKET_HOST, MESSAGE_JSON)
          .catch((err: Error) =>
            console.error(`Bombardment ${i + 1} of ${NUMBER_OF_BOMBS} failed. Error: ${err}`)
          )
      })
    }
    await Promise.all(promises.map((p) => p()))
  }
}

// console.log('Starting socket bombardment: socketBombardment')
// socketBombardment()
//   .then(() => {
//     console.log('Socket bombardment complete')
//     process.exit(0)
//   })
//   .catch((err) => {
//     console.log(err)
//     process.exit(1)
//   })

console.log('Starting socket bombardment: socketBombardmentWithLimitedActiveSockets')
socketBombardmentWithLimitedActiveSockets(5)
  .then(() => {
    console.log('Socket bombardment complete')
    process.exit(0)
  })
  .catch((err) => {
    console.log(err)
    process.exit(1)
  })
