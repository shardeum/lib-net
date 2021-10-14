// validate opts
const validate = (opts) => {
  if (!opts) throw new Error('snq: must supply options')

  if (!opts.port || typeof opts.port !== 'number') throw new Error('snq: must supply port')
}

export default validate