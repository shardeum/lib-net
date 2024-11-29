import { Sn } from '../.'

const setupSender = (port: number, senderOpts: any, headerOpts: any) => {
  return Sn({
    port,
    address: '127.0.0.1',
    senderOpts,
    headerOpts,
    crypto: {
      signingSecretKeyHex:
        'c3774b92cc8850fb4026b073081290b82cab3c0f66cac250b4d710ee9aaf83ed8088b37f6f458104515ae18c2a05bde890199322f62ab5114d20c77bde5e6c9d',
      hashKey: '69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc',
    },
  })
}

const main = async () => {
  console.log('Starting servers...')
  let failed = 0
  let passed = 0
  const result1 = await testWhenBothServersSupportHeader()
  result1 === 'passed' ? passed++ : failed++
  const result2 = await testWhenReceiverSupportHeader()
  result2 === 'passed' ? passed++ : failed++
  console.log(`Passed: ${passed}, Failed: ${failed}`)
  const result3 = await testWhenSenderSupportHeader()
  result3 === 'passed' ? passed++ : failed++
  console.log(`Passed: ${passed}, Failed: ${failed}`)
}

const testWhenBothServersSupportHeader = async (): Promise<string> => {
  let testResult = 'failed'

  // setup test servers
  const sn1 = setupSender(44444, { useLruCache: true, lruSize: 2 }, { sendHeaderVersion: 1 })

  sn1.listen((data: any) => {
    console.log('Received message on 44444:', data)
    if (data && data.message === 'pong') {
      console.log('Received pong from 44444:', data.fromPort)
      testResult = 'passed'
    }
  })

  const sn2 = setupSender(44445, { useLruCache: true, lruSize: 2 }, { sendHeaderVersion: 1 })
  sn2.listen((data: any, remote, respond, header) => {
    console.log('Received message on 44445:', data)
    if (data && data.message === 'ping') {
      console.log('Received pong from 44445:', data.fromPort)
      testResult = 'passed'
    }
    console.log('Header:', header)
    return respond({ message: 'pong', fromPort: 44445 })
  })

  sn1.sendWithHeader(
    44445,
    '127.0.0.1',
    { message: 'ping', fromPort: 44444 },
    {
      sender_id: '0xabc',
    },
    1000
  )

  await sleep(2000)

  return testResult
}

const testWhenReceiverSupportHeader = async (): Promise<string> => {
  let testResult = 'failed'

  // setup test servers
  const sn1 = setupSender(44446, { useLruCache: true, lruSize: 2 }, {})

  sn1.listen((data: any, remote, respond, header) => {
    console.log('Received message on 44444:', data)
    if (data && data.message === 'pong') {
      console.log('Received pong from 44444:', data.fromPort)
      testResult = 'passed'
    }
  })

  const sn2 = setupSender(44447, { useLruCache: true, lruSize: 2 }, { sendHeaderVersion: 1 })
  sn2.listen((data: any, remote, respond, header) => {
    console.log('Received message on 44445:', data)
    if (data && data.message === 'ping') {
      console.log('Received pong from 44445:', data.fromPort)
      testResult = 'passed'
    }
    return respond({ message: 'pong', fromPort: 44445 })
  })

  sn1.send(44447, '127.0.0.1', { message: 'ping', fromPort: 44444 }, 1000)

  await sleep(2000)

  return testResult
}

const testWhenSenderSupportHeader = async (): Promise<string> => {
  let testResult = 'failed'

  // setup test servers
  const sn1 = setupSender(44448, { useLruCache: true, lruSize: 2 }, { sendHeaderVersion: 1 })

  sn1.listen((data: any, remote, respond, header) => {
    console.log('Received message on 44444:', data)
    if (data && data.message === 'pong') {
      console.log('Received pong from 44444:', data.fromPort)
      testResult = 'passed'
    }
  })

  const sn2 = setupSender(44449, { useLruCache: true, lruSize: 2 }, {})
  sn2.listen((data: any, remote, respond, header) => {
    console.log('Received message on 44445:', data)
    if (data && data.message === 'ping') {
      console.log('Received pong from 44445:', data.fromPort)
      testResult = 'passed'
    }
    return respond({ message: 'pong', fromPort: 44445 })
  })

  sn1.send(44449, '127.0.0.1', { message: 'ping', fromPort: 44444 }, 1000)

  await sleep(2000)

  return testResult
}

const sleep = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((err) => console.error('ERROR: ', err))
