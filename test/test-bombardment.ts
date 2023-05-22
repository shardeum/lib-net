import { Sn } from '../build/src'

// Test constants

const NUMBER_OF_SOCKET_CLIENTS = 1000 // Unique socket clients to be used for the bombardment
const STARTING_PORT = 49152
const NUMBER_OF_BOMBS: number = -1 // Number of socket bombs to be sent per socket client (-1 for infinite)
const TARGET_SOCKET_HOST = '127.0.0.1' // Internal host of the validator to be bombarded
const TARGET_SOCKET_PORT = 10001 // Internal port of the validator to be bombarded
const MESSAGE_JSON = { route: '/bombardment-test', payload: 'Hello, world!' } // Message to be sent to the validator

// Test variables

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const socketClients: any[] = []

// Setup helpers

function setupSocketClients() {
  for (let i = 0; i < NUMBER_OF_SOCKET_CLIENTS; i++) {
    const port = STARTING_PORT + i
    socketClients.push(Sn({ port }))
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
  await delay(10000)

  for (let i = 0; i < NUMBER_OF_BOMBS || NUMBER_OF_BOMBS === -1; i++) {
    const promises: Promise<void>[] = []
    console.log(`Bombardment ${i + 1} of ${NUMBER_OF_BOMBS === -1 ? 'infinite' : NUMBER_OF_BOMBS}`)
    for (let j = 0; j < NUMBER_OF_SOCKET_CLIENTS; j++) {
      console.log(`Sending message ${j + 1} of ${NUMBER_OF_SOCKET_CLIENTS}`)
      // eslint-disable-next-line security/detect-object-injection
      promises.push(
        socketClients[j]
          .send(TARGET_SOCKET_PORT, TARGET_SOCKET_HOST, MESSAGE_JSON)
          .catch((err) => console.error(`Bombardment ${i + 1} of ${NUMBER_OF_BOMBS} failed. Error: ${err}`))
      )
    }
    await Promise.all(promises)
  }
}

socketBombardment()
  .then(() => {
    console.log('Socket bombardment complete')
    process.exit(0)
  })
  .catch((err) => {
    console.log(err)
    process.exit(1)
  })
