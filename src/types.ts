export type Address = string

export type Port = number

/**
 * Represents augmented data that includes metadata such as timestamps and message direction to be sent over the network.
 */
export interface AugmentedData {
  data: unknown
  UUID: string
  PORT: Port
  ADDRESS?: Address

  // Metadata
  sendTime: number // timestamp of when the message was sent
  receivedTime: number // timestamp of when the message was received
  replyTime: number // timestamp of when the reply was received
  replyReceivedTime: number // timestamp of when the reply was received
  timeout: number // timeout in ms
  msgDir: 'ask' | 'tell' | 'resp' // direction and intent of the message
}

export const NewAugData = (
  data: unknown,
  UUID: string,
  port: number,
  address: string,
  timeoutInMs: number,
  msgDir: 'ask' | 'tell' | 'resp'
): AugmentedData => {
  // Under the hood, sn needs to pass around some extra data for its own internal usage.
  return {
    data,
    UUID,
    PORT: port,
    ADDRESS: address,

    sendTime: Date.now(),
    receivedTime: 0,
    replyTime: 0,
    replyReceivedTime: 0,
    timeout: timeoutInMs,
    msgDir,
  }
}

export type SnOpts = {
  port: number
  address?: string
  senderOpts?: {
    useLruCache?: boolean
    lruSize: number
  }
  headerOpts?: {
    sendHeaderVersion: number
  }
  customStringifier?: (val) => string
  crypto: {
    hashKey: string
    signingSecretKeyHex: string
  }
}

/**
 * Validates the provided options object for the SnOpts type.
 * @param opts - The options object to validate.
 * @throws An error if the options object is not valid.
 */
export const validateSnOpts = (opts: SnOpts): void => {
  if (!opts) throw new Error('snq: must supply options')

  if (!opts.port || typeof opts.port !== 'number') throw new Error('snq: must supply port')

  if (!opts.crypto.hashKey || typeof opts.crypto.hashKey !== 'string')
    throw new Error('snq: must supply hashKey')

  if (opts.senderOpts && opts.senderOpts.useLruCache && !opts.senderOpts.lruSize)
    throw new Error('snq: must supply lruSize when using lruCache')
}

export interface RemoteSender {
  address: string | undefined
  port: number | undefined
}

export type ResponseCallback = (data?: unknown, header?: AppHeader, sign?: Sign) => void

export type ListenerResponder = (data?: unknown, header?: AppHeader) => void

export type TimeoutCallback = () => void

export type ListenCallback = (data: unknown, remote: RemoteSender, respond: ResponseCallback) => void

export interface AppHeader {
  sender_id?: string
  tracker_id?: string
  verification_data?: string
  compression?: string
}

export interface CombinedHeader {
  uuid: string
  sender_id?: string
  tracker_id?: string
  verification_data?: string
  compression?: string
}

export type CompressionTechnique = 'Gzip' | 'Brotli'

export interface Sign {
  owner: string
  sig: string
}

export type GetSenderAddressResult = { address: string; isValid: boolean }
