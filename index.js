let express = require('express')
const http = require('http')
const socketio = require('socket.io')
const ssbClient = require('ssb-client')

require('dotenv').config()
const ssbTimeout = parseInt(process.env.SSB_TIMEOUT)
const doStartSbot = parseInt(process.env.START_SBOT)
const doLog = parseInt(process.env.SBOT_LOG)
const clearLog = parseInt(process.env.SBOT_LOG_CLEAR)

// transform env commands into correct format for spawn function
let netstatString = process.env.NETSTAT_COMMAND.split(' ')
const netstatCmd = netstatString.shift()
const netstatArgs = netstatString
let sbotString = process.env.SBOT_COMMAND.split(' ')
const sbotCmd = sbotString.shift()
const sbotArgs = sbotString

express = express()
const server = http.Server(express)
const io = new socketio(server)
const port = process.env.PORT || 3001

const checkForServer = () => {
  // returns promise that resolves true if sbot is available(false if not)
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process')
    const child = spawn(netstatCmd, netstatArgs) // run netstat
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', d => {
      // parse netstat output
      const lines = d.split('\n')
      lines.forEach(line => {
        if (line.includes('LISTEN') && line.includes('8008')) {
          // something is listening on 8008...
          ssbClient(function(err, sbot) {
            if (err) {
              console.error('sbot client initialization error')
              resolve(false)
            }
            sbot.whoami(function(err, info) {
              if (err) {
                console.error('sbot error')
                resolve(false)
                sbot.close()
              }
              // it's sbot
              resolve(true)
              sbot.close()
            })
          })
        }
      })
    })
    timeout(1000).then(() => resolve(false)) // report sbot is down after 2 seconds
  })
}

function timeout(ms) {
  // promisify setTimeout
  return new Promise(resolve => setTimeout(resolve, ms))
}

const startSbot = () => {
  return new Promise((res, rej) => {
    const { spawn } = require('child_process')
    const fs = require('fs')
    const child = spawn(sbotCmd, sbotArgs, { detached: true })

    if (doLog) {
      console.log('> logging sbot output to sbot.log')
      const logFile = './sbot.log'
      if (clearLog)
        fs.truncate(logFile, 0, () => console.log('> log file cleared'))
      const out = fs.openSync(logFile, 'a')
      const outStream = fs.createWriteStream('', { fd: out })
      child.stdout.pipe(outStream)
      child.stderr.pipe(outStream)
    }

    let streamsStarted = false // ensures live streams start once
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', async d => {
      io.emit('sbot', d) // broadcast log to connected sockets
      if (d.includes('my key ID') && !streamsStarted) {
        streamsStarted = true
        res()
      }
    })
    child.stderr.on('data', d => {
      console.error(d)
    })
    child.on('close', code => {
      console.error(`> sbot process exited`)
    })
    child.unref()
  })
}

let sockets = []
io.on('connection', socket => {
  sockets.push(socket)
  console.log(`user joined (${sockets.length} connected)`)
  socket.on('disconnect', () => {
    sockets = sockets.filter(s => (s.id !== socket.id ? true : false))
    console.log(`user left (${sockets.length} connected)`)
  })
})

express.listen(port, async err => {
  if (err) throw err
  console.log(`> listening on port ${port}`)
  console.log('> checking for sbot')
  let serverReady = await checkForServer()
  if (!serverReady && doStartSbot) {
    console.log('> starting sbot')
    await startSbot()
    // temporary way to ensure starting streams isn't attempted before sbot is ready
    // startBot resolves its promise once sbot key is parsed from sbot output
    await timeout(ssbTimeout)
  } else {
    console.log('> waiting for sbot...')
    let sbotReady = false
    while (!sbotReady) {
      sbotReady = await checkForServer()
      await timeout(2000)
    }
  }
  console.log('> starting live streams')
  startStreams()
})

const waitForServer = async () => {
  let sbotReady = false
  while (!sbotReady) {
    console.log('> waiting for sbot...')
    sbotReady = await checkForServer()
    await timeout(2000)
  }
  console.log('> starting live streams')
  startStreams()
}

const startStreams = () => {
  /*
  three streams are created to the ssb network to listen for different activity:
  1. user (wrapped in a whoami function call for providing id)
  2. feed
  3. log
  sbot api details: https://github.com/ssbc/scuttlebot/blob/master/api.md
  */
  let waiting = false
  ssbClient((err, sbot) => {
    if (err) throw err
    const pull = require('pull-stream')
    // user
    sbot.whoami((err, me) => {
      if (err) throw err
      const userSource = sbot.createUserStream({ id: me.id, live: true })
      const userSink = pull.collect((err, msgs) => {
        if (err) {
          //throw err
          if (!waiting) {
            console.log('> sbot unavailable')
            waiting = true
            waitForServer()
          }
        }
        io.emit('user-stream', msgs)
      })
      pull(userSource, userSink)
      console.log('> user-stream channel up')
    })
    // feed
    const feedSource = sbot.createFeedStream({ live: true })
    const feedSink = pull.collect((err, msgs) => {
      if (err) {
        //throw err
        if (!waiting) {
          console.log('> sbot unavailable')
          waiting = true
          waitForServer()
        }
      }
      io.emit('feed-stream', msgs)
    })
    pull(feedSource, feedSink)
    console.log('> feed-stream channel up')
    // log
    const logSource = sbot.createLogStream({ live: true })
    const logSink = pull.collect((err, msgs) => {
      if (err) {
        //throw err
        if (!waiting) {
          console.log('> sbot unavailable')
          waiting = true
          waitForServer()
        }
      }
      io.emit('log-stream', msgs)
    })
    pull(logSource, logSink)
    console.log('> log-stream channel up')
  })
}
