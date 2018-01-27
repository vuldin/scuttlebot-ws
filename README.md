# scuttlebot-ws

A [socket.io](https://socket.io/) WebSocket wrapper for [scuttlebot](https://scuttlebot.io/)

## Install

```
npm install
```

## Plans

I created this app in order to allow for an sbot instance on a raspberry-pi to be usable by a webapp on my phone.
This is an [express](https://expressjs.com/) server with three websocket channels (so far):

* user-stream
* feed-stream
* log-stream

## Remaining tasks

### Retrieve history

The websocket channels allow any incoming messages to be available to a listening app in real-time.
The next step is to ensure some number of previous messages to be made available.
This can also be done using streams via a websocket channel, but this needs to be implemented.

### Authentication

Webapp clients will be run from anywhere given the increasing use of p2p technologies such as [ssb](https://scuttlebot.io/), [IPFS](https://ipfs.io/), and [Dat](https://datproject.org/).
Communication between these client instances and this server need to be secured via authentication.

### Storage considerations

The plan is to run this server (and sbot) on a Raspberri Pi.
But sbot by default writes the entire feed of a user to `~/.ssb` (on Linux and OSX).
This directory can easily and quickly reach multiple gigabytes, which is a problem on single board computers (SBCs).
There are some possible solutions for this:

* emit older messages to clients without saving to disk
  * periodically prune saved messages
* mount `~/.ssb` to an external mount point
* limit the amount of historic messages retrieved by default
