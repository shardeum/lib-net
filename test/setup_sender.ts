import { Sn } from '../.'

const RESPONSE_DELAY_MILLIS = 500
const USE_LRU_CACHE = true

const setupLruSender = () => {
  const port = 49152
  if (USE_LRU_CACHE) {
    return Sn({
      port,
      senderOpts: {
        useLruCache: true,
        lruSize: 5,
      },
      signingSecretKeyHex:
        'c3774b92cc8850fb4026b073081290b82cab3c0f66cac250b4d710ee9aaf83ed8088b37f6f458104515ae18c2a05bde890199322f62ab5114d20c77bde5e6c9d',
    })
  } else {
    return Sn({
      port,
      signingSecretKeyHex:
        'c3774b92cc8850fb4026b073081290b82cab3c0f66cac250b4d710ee9aaf83ed8088b37f6f458104515ae18c2a05bde890199322f62ab5114d20c77bde5e6c9d',
    })
  }
}

const main = async () => {
  const sn = setupLruSender()
  let counter = 0
  await sn.listen((data: unknown, remote, respond) => {
    console.log(`${data}`)
    console.log(`Received: ${JSON.stringify(data)} from ${JSON.stringify(remote)}`)

    setTimeout(() => {
      respond('Response message')
    }, RESPONSE_DELAY_MILLIS)

    if (counter++ % 1000 === 0) console.log(sn.stats())
  })
}

main().catch((err) => console.log('ERROR: ', err))
