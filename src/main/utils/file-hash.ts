import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { FileHashError } from '../domain/errors'

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)

    stream.on('error', (error) => {
      reject(new FileHashError('Unable to read file for SHA-256 hashing', error))
    })

    stream.on('data', (chunk) => {
      hash.update(chunk)
    })

    stream.on('end', () => {
      resolve(hash.digest('hex'))
    })
  })
}
