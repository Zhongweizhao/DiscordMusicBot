const Discord = require('discord.js');
const axios = require('axios');
const ytdl = require('ytdl-core');
const search = require('youtube-search');
const getYotubePlaylistId = require('get-youtube-playlist-id');
const ytpl = require('ytpl');
const isPlaylist = require('is-playlist');

const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const bot = new Discord.Client();

function loadSecretEnv() {
  return new Promise((resolve, reject) => {
    let config = {};
    const secretConfigPath = path.resolve(__dirname, 'env.ejson');
    if (fs.existsSync(secretConfigPath)){
      exec(`ejson decrypt ${secretConfigPath}`, (err, stdout, stderr) => {
        if (stderr) {
          reject(stderr);
        } else {
          config = Object.assign(config, JSON.parse(stdout));
          resolve(config);
        }
      });
    } else {
      resolve(config);
    }
  })
}

const run = (secretEnv) => {
  process.env = Object.assign(process.env, secretEnv);

  const searchOpts = {
    maxResults: 1,
    key: process.env.YOUTUBE_TOKEN,
  };

  const token = process.env.BOT_TOKEN;

  const helpText = `
    /add youtube_url        add a song from youtube url to queue
    /addplaylist ytpl_url   add songs from youtube playlist url to queue
    /search query           search for a song
    /volume 1-100           set volume
    /skip                   skip current song
    /queue                  show queue
    /clear                  clear queue including current playing one
    /play                   resume muisc
    /pause                  pause music
    /help                   show this message
  `

  class ConnectionManager {
    constructor(voiceConnection, textChannel, voiceChannelID, volume = 15) {
      this.voiceConnection = voiceConnection;
      this.textChannel = textChannel;
      this.voiceChannelID = voiceChannelID;
      this.queue = [];
      this.volume = volume;
      this.index = 0;
      this.dispatch = null;
    }

    async addLink(link, by) {
      const info = await ytdl.getInfo(link);
      this.queue.push({ link, title: info.title, by });
      this.send(`${info.title} added by ${by}`);
      if (!this.dispatch || this.dispatch.destroyed) {
        this._playNext();
      }
    }

    resume() {
      if (this.dispatch) {
        this.dispatch.resume();
      }
    }

    pause() {
      if (this.dispatch) {
        this.dispatch.pause();
      }
    }

    skip() {
      // when the dispatch is destroyed, finish event is generated,
      // which will call this._playNext()
      if (this.dispatch || !this.dispatch.destroyed) this.dispatch.destroy();
    }

    send(msg) {
      this.textChannel.send('```' + msg + '```');
    }

    setVolume(volume) {
      this.send(`Volume change from ${this.volume} to ${volume}`);
      this.volume = volume;
      this.dispatch.setVolume(this.volume / 50);
    }

    printQueue() {
      return this.queue.map((q, i) =>
        `${i === this.index ? 'Playing' : (i + 1)}. ${q.title} added by ${q.by}`
      ).join('\n');
    }

    clear() {
      this.queue = [];
      if (this.dispatch || !this.dispatch.destroyed) this.dispatch.destroy();
    }

    _playNext() {
      if (this.queue.length === 0) return;
      this.index = (this.index + 1) % this.queue.length;
      this.send(`Playing ${this.queue[this.index].title} added by ${this.queue[this.index].by}`);
      this.dispatch = this.voiceConnection
        .play(ytdl(this.queue[this.index].link), { passes: 3 })
        .on('finish', () => {
          this._playNext();
        });
      this.dispatch.setVolume(this.volume / 10);
    }
  }

  let connectionManager = null;

  bot.on('ready', () => {
    console.log('bot ready');
  });

  bot.on('message', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!message.member.voiceChannel) return;
    if (message.content.indexOf('/') !== 0) return;
    if (message.content.length === 1) return;

    const splitted = message.content.substring(1).split(' ');
    const command = splitted[0];
    const content = splitted.slice(1).join(' ');

    if (!command) return;

    // console.log('command', command);
    // console.log('content', content);

    if (!connectionManager ||
      connectionManager.voiceChannelID !== message.member.voiceChannelID
    ) {
      if (connectionManager) connectionManager.clear();
      connectionManager = new ConnectionManager(
        await message.member.voiceChannel.join(),
        message.channel,
        message.member.voiceChannelID,
      );
    }

    switch (command) {
      case 'add':
        if (ytdl.validateURL(content)) {
          connectionManager.addLink(content, message.author.username);
        } else {
          connectionManager.send('enter valid youtube url');
        }
        break;
      case 'addplaylist':
        if (!isPlaylist(content)) {
          connectionManager.send('enter valid youtube playlist url');
        } else {
          const id = getYotubePlaylistId(content);
          ytpl(id, (err, playlist) => {
            if (err) connectionManager.send('cannot process playlist');
            else {
              playlist.items.forEach(video => {
                connectionManager.addLink(video.url, message.author.username);
              })
            }
          });
        }
        break;
      case 'search':
        if (content.trim() === '') {
          connectionManager.send(helpText);
        } else {
          search(content, searchOpts, function(err, results) {
            if (err) return console.log(err);
            connectionManager.addLink(results[0].link, message.author.username);
          });
        }
        break;
      case 'pause':
        connectionManager.pause();
        break;
      case 'play':
        connectionManager.resume();
        break;
      case 'queue':
        if (connectionManager.queue.length === 0) {
          connectionManager.send('queue empty');
        } else {
          connectionManager.send(connectionManager.printQueue());
        }
        break;
      case 'skip':
        connectionManager.skip();
        break;
      case 'volume':
        const volume = parseInt(content, 10);
        if (!volume || volume < 1 || volume > 100) {
          connectionManager.send('enter volume from 1 to 100');
        } else {
          connectionManager.setVolume(parseInt(content, 10));
        }
        break;
      case 'clear':
        connectionManager.clear();
        break;
      case 'help':
        connectionManager.send(helpText);
        break;
      default:
        return;
    }
  });

  bot.login(token);
}

loadSecretEnv().then(run);
