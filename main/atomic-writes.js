const fs = require('fs')
const path = require('path')

function tmpName(target) {
  return `${target}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
}

function atomicWriteFileSync(target, data, encoding) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = tmpName(target)
  fs.writeFileSync(tmp, data, encoding || undefined)
  try {
    fs.renameSync(tmp, target)
  } catch (err) {
    try { fs.unlinkSync(tmp) } catch {}
    throw err
  }
}

function atomicWriteJsonSync(target, obj) {
  atomicWriteFileSync(target, JSON.stringify(obj, null, 2), 'utf-8')
}

module.exports = { atomicWriteFileSync, atomicWriteJsonSync }
