import fs from 'fs'
import path from 'path'

const sourceFile = path.join(__dirname, '../', 'target', 'x86_64-apple-darwin', 'debug', 'libshardus_net.dylib')
const targetFile = path.join(__dirname, '../', 'shardus-net.node')

fs.copyFile(sourceFile, targetFile, (err) => {
  if (err) {
    console.error('Error copying file:', err)
  } else {
    console.log('File copied and renamed successfully')
  }
})
