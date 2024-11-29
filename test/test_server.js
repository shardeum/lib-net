const { rejects } = require('assert')
const { resolve } = require('path/posix')
const { Sn } = require('../.')
const address = '127.0.0.1'
const port = 5001

const sn = Sn({
  address,
  port,
})

const RESPONSE_DELAY_MILLIS = 1000

const main = async () => {
  await sn.listen((data, remote, respond) => {
    console.log(`Received: ${data.length} from ${JSON.stringify(remote)}`)

    setTimeout(() => {
      if (!data.startsWith('Response')) {
        respond('Response message')
      }
    }, RESPONSE_DELAY_MILLIS)

    console.log(sn.stats())
  })
}

main().catch((err) => console.log('ERROR: ', err))

function wait() {
  setTimeout(wait, 200)
}

wait()
