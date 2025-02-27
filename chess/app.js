/**
 * P2P Chess Game Implementation using js-chess-engine
 */

/** @typedef {import('pear-interface')} */
/* global Pear */

import Hyperswarm from 'hyperswarm'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'
import { Game } from 'js-chess-engine'

const { teardown, updates } = Pear

// Initialize P2P networking
const swarm = new Hyperswarm()

// Game state variables
const gameState = {
  stage: 'room-selection',
  username: null,
  playerColor: null,
  opponentInfo: {
    username: null,
    color: null
  },
  gameStarted: false,
  roomCode: null,
  isRoomCreator: false,
  game: null
}

// Cleanup handlers
teardown(() => swarm.destroy())
updates(() => Pear.reload())

/**
 * Debug utility to display messages in the debug panel
 */
function debug(message, type = 'info') {
  const debugPanel = document.getElementById('debug-panel')
  if (!debugPanel) return

  const entry = document.createElement('div')
  entry.className = `debug-entry ${type}`
  entry.textContent = `${new Date().toLocaleTimeString()}: ${message}`
  debugPanel.appendChild(entry)
  debugPanel.scrollTop = debugPanel.scrollHeight
  console.log(`[${type}] ${message}`)

  while (debugPanel.children.length > 50) {
    debugPanel.removeChild(debugPanel.firstChild)
  }
}

// Initialize UI when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  try {
    debug('Initializing game UI...')
    initializeUI()
    setupEventListeners()
    initializeTheme()
    debug('Game UI initialized successfully', 'success')
  } catch (error) {
    debug(`Error initializing game UI: ${error.message}`, 'error')
    console.error('Initialization error:', error)
  }
})

// Theme functionality
function initializeTheme() {
  const theme = localStorage.getItem('theme') || 'light'
  document.documentElement.setAttribute('data-theme', theme)
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme')
  const newTheme = currentTheme === 'light' ? 'dark' : 'light'
  document.documentElement.setAttribute('data-theme', newTheme)
  localStorage.setItem('theme', newTheme)
}

function showStage(stageName) {
  try {
    debug(`Attempting to show stage: ${stageName}`)
    const stages = document.querySelectorAll('.stage')
    stages.forEach(stage => stage.classList.add('hidden'))
    const targetStage = document.getElementById(`stage-${stageName}`)
    if (!targetStage) throw new Error(`Stage not found: ${stageName}`)
    targetStage.classList.remove('hidden')
    gameState.stage = stageName
    debug(`Successfully switched to stage: ${stageName}`, 'success')
  } catch (error) {
    debug(`Error showing stage ${stageName}: ${error.message}`, 'error')
  }
}

function initializeUI() {
  playSound('gameBackgroundSound')
  const requiredElements = [
    'debug-panel',
    'stage-room-selection',
    'stage-room-setup',
    'stage-game',
    'loading'
  ]

  const missingElements = requiredElements.filter(id => !document.getElementById(id))
  if (missingElements.length) {
    throw new Error(`Missing required elements: ${missingElements.join(', ')}`)
  }

  showStage('room-selection')
}

function setupEventListeners() {
  try {
    // Room Selection Stage
    const createRoomBtn = document.getElementById('create-room-btn')
    const joinRoomBtn = document.getElementById('join-room-btn')

    createRoomBtn.addEventListener('click', () => {
      showStage('room-setup')
      document.getElementById('create-room-form').classList.remove('hidden')
      document.getElementById('join-room-form').classList.add('hidden')
    })

    joinRoomBtn.addEventListener('click', () => {
      showStage('room-setup')
      document.getElementById('join-room-form').classList.remove('hidden')
      document.getElementById('create-room-form').classList.add('hidden')
    })

    setupRoomEventListeners()
    setupGameInterfaceListeners()
    debug('Event listeners setup completed', 'success')
  } catch (error) {
    debug(`Error setting up event listeners: ${error.message}`, 'error')
  }
}

function setupRoomEventListeners() {
  const createRoomSubmit = document.getElementById('create-room-submit')
  const joinRoomSubmit = document.getElementById('join-room-submit')
  const copyRoomCode = document.getElementById('copy-room-code')

  createRoomSubmit.addEventListener('click', async (e) => {
    e.preventDefault()
    const username = document.getElementById('create-username').value.trim()
    if (!username) {
      debug('Username is required', 'error')
      return
    }

    gameState.username = username
    gameState.isRoomCreator = true

    const topicBuffer = crypto.randomBytes(32)
    gameState.roomCode = b4a.toString(topicBuffer, 'hex')

    document.getElementById('room-code-display').value = gameState.roomCode
    document.getElementById('room-code-display-container').classList.remove('hidden')
    createRoomSubmit.classList.add('hidden')

    await joinSwarm(topicBuffer)
  })

  joinRoomSubmit.addEventListener('click', async (e) => {
    e.preventDefault()
    const username = document.getElementById('join-username').value.trim()
    const roomCode = document.getElementById('room-code-input').value.trim()

    if (!username || !roomCode) {
      debug('Username and room code are required', 'error')
      return
    }

    gameState.username = username
    gameState.roomCode = roomCode

    try {
      const topicBuffer = b4a.from(roomCode, 'hex')
      await joinSwarm(topicBuffer)
    } catch (err) {
      debug('Invalid room code', 'error')
    }
  })

  copyRoomCode.addEventListener('click', async () => {
    const roomCode = document.getElementById('room-code-display').value
    await navigator.clipboard.writeText(roomCode)
    debug('Room code copied to clipboard', 'success')
  })
}

function setupGameInterfaceListeners() {
  const messageForm = document.getElementById('message-form')
  messageForm.addEventListener('submit', sendMessage)

  const chessBoard = document.getElementById('chess-board')
  chessBoard.addEventListener('click', handleBoardClick)
}

// P2P Communication
swarm.on('connection', (peer) => {
  if (swarm.connections.size > 1) {
    peer.destroy()
    return
  }

  debug('Peer connected', 'success')

  if (gameState.isRoomCreator) {
    gameState.playerColor = 'white'
    gameState.opponentInfo.color = 'black'
  } else {
    gameState.playerColor = 'black'
    gameState.opponentInfo.color = 'white'
  }

  peer.on('data', data => {
    try {
      const message = JSON.parse(b4a.toString(data))
      switch (message.type) {
        case 'move':
          handleGameMessage(message)
          break
        case 'chat':
          handleChatMessage(message)
          break
      }
    } catch (e) {
      debug(`Error handling message: ${e.message}`, 'error')
    }
  })

  peer.on('error', e => debug(`Connection error: ${e}`, 'error'))
  startGame()
})

function startGame() {
  gameState.gameStarted = true
  gameState.game = new Game()
  showStage('game')

  debug('Starting new game', 'info')
  debug(`Player color: ${gameState.playerColor}`, 'info')
  
  const config = gameState.game.exportJson()
  debug('Initial board configuration:', 'info')
  debug(JSON.stringify(config.pieces, null, 2), 'info')

  updatePlayerInfo('player-info', gameState.username, gameState.playerColor)
  updatePlayerInfo('opponent-info', gameState.opponentInfo.username, gameState.opponentInfo.color)
  
  renderBoard()
  updateGameStatus()
  playSound('gameStartSound')
  debug('Game started', 'success')
}

function renderBoard() {
  const chessBoard = document.getElementById('chess-board')
  chessBoard.innerHTML = ''
  
  const configuration = gameState.game.exportJson()
  const pieces = configuration.pieces
  const moves = configuration.moves
  const isBlackPlayer = gameState.playerColor === 'black'

  debug('Current board configuration:', 'info')
  debug(JSON.stringify(configuration, null, 2), 'info')

  // Create the 8x8 grid
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const square = document.createElement('div')
      
      // Get the position in chess notation (e.g., 'E2')
      const files = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
      const ranks = ['8', '7', '6', '5', '4', '3', '2', '1']
      
      // Calculate position based on player's perspective
      const displayRow = isBlackPlayer ? (7 - row) : row
      const displayCol = isBlackPlayer ? (7 - col) : col
      const position = files[displayCol] + ranks[displayRow]
      
      square.className = `chess-square ${(row + col) % 2 === 0 ? 'white' : 'black'}`
      square.dataset.position = position

      // Add piece if exists at this position
      if (pieces[position]) {
        debug(`Adding piece ${pieces[position]} at position ${position}`, 'info')
        const img = document.createElement('img')
        img.src = `chesspieces/${getPieceImage(pieces[position])}`
        img.className = 'chess-piece'
        img.draggable = true
        square.appendChild(img)
      }

      // Highlight valid moves
      if (moves[position]) {
        square.classList.add('valid-move')
        debug(`Valid moves for ${position}: ${JSON.stringify(moves[position])}`, 'info')
      }

      chessBoard.appendChild(square)
    }
  }
}

function getPieceImage(piece) {
  debug(`Getting image for piece: ${piece}`, 'info')
  
  // Map piece notation to image filename
  const pieceMap = {
    'K': 'wK.png', 'Q': 'wQ.png', 'R': 'wR.png', 'B': 'wB.png', 'N': 'wN.png', 'P': 'wP.png',  // White pieces
    'k': 'bK.png', 'q': 'bQ.png', 'r': 'bR.png', 'b': 'bB.png', 'n': 'bN.png', 'p': 'bP.png'   // Black pieces
  }

  const imageName = pieceMap[piece]
  if (!imageName) {
    debug(`Warning: Unknown piece type ${piece}`, 'error')
    return 'unknown.png'
  }

  debug(`Using image: ${imageName}`, 'info')
  return imageName
}

function handleBoardClick(event) {
  const square = event.target.closest('.chess-square')
  if (!square) return

  const position = square.dataset.position
  const configuration = gameState.game.exportJson()

  // Check if it's player's turn
  const isPlayerTurn = configuration.turn.toLowerCase() === gameState.playerColor
  if (!isPlayerTurn) {
    debug(`Not your turn! Current turn: ${configuration.turn}`, 'error')
    return
  }

  // Check if the clicked piece belongs to the player
  const piece = configuration.pieces[position]
  if (piece) {
    const isPieceWhite = piece === piece.toUpperCase()
    const isPlayerWhite = gameState.playerColor === 'white'
    
    // If trying to move opponent's piece, return
    if (isPieceWhite !== isPlayerWhite) {
      debug(`Cannot move opponent's pieces!`, 'error')
      return
    }
  }

  if (configuration.moves[position]) {
    const move = gameState.game.move(position, configuration.moves[position][0])
    broadcastMove(position, configuration.moves[position][0])
    renderBoard()
    updateGameStatus()
    playSound('moveSound')
  }
}

function updateGameStatus() {
  const status = document.getElementById('game-status')
  const configuration = gameState.game.exportJson()
  
  if (!gameState.gameStarted) {
    status.textContent = 'Waiting for opponent...'
    return
  }

  const isYourTurn = configuration.turn.toLowerCase() === gameState.playerColor
  status.textContent = `${configuration.turn}'s turn${isYourTurn ? ' (Your turn)' : ''}`
  
  if (configuration.check) {
    status.textContent += ' - CHECK!'
    playSound('checkSound')
  }
  
  if (configuration.checkMate) {
    status.textContent += ' - CHECKMATE!'
    playSound('gameOverSound')
    const winner = configuration.turn === 'WHITE' ? 'Black' : 'White'
    setTimeout(() => alert(`Checkmate! ${winner} wins!`), 100)
  }
}

function broadcastMove(from, to) {
  const message = {
    type: 'move',
    from,
    to
  }

  const peers = [...swarm.connections]
  for (const peer of peers) {
    peer.write(b4a.from(JSON.stringify(message)))
  }
}

function handleGameMessage(message) {
  if (message.type === 'move') {
    gameState.game.move(message.from, message.to)
    renderBoard()
    updateGameStatus()
    playSound('moveSound')
  }
}

// Chat functionality
function sendMessage(e) {
  e.preventDefault()
  const messageInput = document.querySelector('#message')
  const text = messageInput.value.trim()

  if (!text) return

  const message = {
    type: 'chat',
    username: gameState.username,
    text: text
  }

  const peers = [...swarm.connections]
  for (const peer of peers) {
    peer.write(b4a.from(JSON.stringify(message)))
  }

  onMessageAdded(gameState.username, text)
  messageInput.value = ''
}

function onMessageAdded(username, text) {
  const $div = document.createElement('div')
  $div.className = `message ${username === gameState.username ? 'sent' : 'received'}`

  const messageContent = document.createElement('span')
  messageContent.textContent = text
  messageContent.style.color = '#000000'

  if (username !== gameState.username) {
    const usernameLabel = document.createElement('div')
    usernameLabel.className = 'message-username'
    usernameLabel.textContent = username
    usernameLabel.style.color = '#667781'
    usernameLabel.style.fontSize = '12px'
    usernameLabel.style.marginBottom = '2px'
    $div.appendChild(usernameLabel)
  }

  const timestamp = document.createElement('span')
  timestamp.className = 'message-time'
  timestamp.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  timestamp.style.fontSize = '11px'
  timestamp.style.color = '#667781'
  timestamp.style.marginLeft = '8px'
  timestamp.style.float = 'right'

  $div.appendChild(messageContent)
  $div.appendChild(timestamp)

  const messages = document.querySelector('#messages')
  messages.appendChild($div)
  messages.scrollTop = messages.scrollHeight
}

async function joinSwarm(topicBuffer) {
  showLoading('Connecting to game network...')

  try {
    const discovery = swarm.join(topicBuffer, { client: true, server: true })
    await discovery.flushed()
    hideLoading()

    if (gameState.isRoomCreator) {
      document.getElementById('loading-text').textContent = 'Waiting for opponent...'
    }
  } catch (err) {
    debug(`Failed to join swarm: ${err.message}`, 'error')
    hideLoading()
  }
}

function handleChatMessage(message) {
  const { username, text } = message
  onMessageAdded(username, text)
}

// Loading overlay
function showLoading(text = 'Loading...') {
  document.getElementById('loading').classList.remove('hidden')
  document.getElementById('loading-text').textContent = text
}

function hideLoading() {
  document.getElementById('loading').classList.add('hidden')
}

// Sound functions
function playSound(soundId) {
  const sound = document.getElementById(soundId)
  if (sound) {
    sound.currentTime = 0
    sound.play().catch(error => console.log('Error playing sound:', error))
  }
}

function updatePlayerInfo(elementId, username, color) {
  const element = document.getElementById(elementId)
  element.querySelector('.username').textContent = username
  element.querySelector('.color').textContent = `Playing as ${color}`
}
