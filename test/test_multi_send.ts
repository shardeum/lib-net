import { Command } from 'commander'
import { Sn } from '../.'

const setupLruSender = (
  port: number,
  lruSize: number,
  limits: {
    payloadSize?: number
    headerSize?: number
    signatureSize?: number
    ownerSize?: number
  }
) => {
  return Sn({
    port,
    address: '127.0.0.1',
    crypto: {
      signingSecretKeyHex:
        'c3774b92cc8850fb4026b073081290b82cab3c0f66cac250b4d710ee9aaf83ed8088b37f6f458104515ae18c2a05bde890199322f62ab5114d20c77bde5e6c9d',
      hashKey: '69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc',
    },
    senderOpts: {
      useLruCache: true,
      lruSize: lruSize,
    },
    headerOpts: {
      sendHeaderVersion: 1,
    },
    payloadSizeLimitInBytes: limits.payloadSize || 2 * 1024 * 1024, // Default 2MB
    headerSizeLimitInBytes: limits.headerSize || 2 * 1024, // Default 2KB
  })
}

const main = async () => {
  /*
    create a cli with the following options:
      -p, --port <port> Port to listen on
      -c, --cache <size> Size of the LRU cache
      --payload-size <size> Payload size limit in bytes
      --header-size <size> Header size limit in bytes
    
    the cli should create a sender with the following options:
      - lruSize: <size>
      - port: <port>
      - limits: { payloadSize, headerSize}

    on running the cli a listener should be started and sending of message with input from terminal should be allowed
  */

  /*
    Commands to use for multi_send_with_header

    ts-node test/test_multi_send.ts -p 44000 -c 2 --payload-size 2097152 --header-size 2048
    path/to/test_multi_send.ts -p <port> -c <cache_size> --payload-size <size> --header-size <size>

    data 3 ping
    <route> <connections to send data> <message>
  */

  console.log('Starting cli...')

  const program = new Command()
  program.requiredOption('-p, --port <port>', 'Port to listen on')
  program.option('-c, --cache <size>', 'Size of the LRU cache', '2')
  program.option('--payload-size <size>', 'Payload size limit in bytes', '2097152') // Default 2MB
  program.option('--header-size <size>', 'Header size limit in bytes', '2048') // Default 2KB
  program.parse(process.argv)

  const port = program.port.toString()
  const cacheSize = program.cache.toString()
  const limits = {
    payloadSize: +program.payloadSize,
    headerSize: +program.headerSize,
  }

  console.log(`Starting listener on port ${port} with cache size ${cacheSize}`)
  console.log(`Limits: ${JSON.stringify(limits, null, 2)}`)
  const sn = setupLruSender(+port, +cacheSize, limits)

  const input = process.stdin
  input.addListener('data', async (data: Buffer) => {
    const inputs = data.toString().trim().split(' ')
    const basePort = 44000
    let ports: number[] = []

    if (inputs.length === 3) {
      let count = Number(inputs[1]) // number of ip addresses you want to send info to
      // make sure you have enough servers setup to listen on based on count
      for (let i = 1; i <= count; i++) {
        let port = basePort + i
        console.log('The port ' + port)
        ports.push(port)
      }
      const baseAddress = '127.0.0.1'
      const addresses = Array(count).fill(baseAddress)
      let message = inputs[2]

      await sn.multiSendWithHeader(
        ports,
        addresses,
        { message, fromPort: +port },
        {
          compression: 'Brotli',
          sender_id: '19df3d34495874352d3540d5ef1074b2b8bb6b28a3f80278bb9c18172276ac57',
        },
        1000
      )
      console.log('Message sent: ', message)
    } else if (inputs.length === 2) {
      sn.evictSocket(+inputs[1], '127.0.0.1')
      console.log('Cache cleared')
    } else {
      console.log('=> send <port> <message>')
      console.log('=> clear <port>')
    }
  })

  sn.listen(async (data: any, remote, respond, header, sign) => {
    if (data && data.message === 'ping') {
      console.log('Received ping from:', data.fromPort)
      console.log('Ping header:', JSON.stringify(header, null, 2))
      return respond(
        { message: 'pong', fromPort: +port },
        {
          compression: 'Brotli',
        }
      )
    }
    if (data && data.message === 'pong') {
      console.log('Received pong from:', data.fromPort)
    }
    if (header) {
      console.log('Received header:', JSON.stringify(header, null, 2))
    }
    if (sign) {
      console.log('Received signature:', JSON.stringify(sign, null, 2))
    }
  })
}

const sleep = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((err) => console.log('ERROR: ', err))
