'use strict';

var os = require('os');
var nodeStatic = require('node-static');
var http = require('http');
var socketIO = require('socket.io');

var fileServer = new(nodeStatic.Server)();

var app = http.createServer(function(req, res) {
    fileServer.serve(req, res);
}).listen(9050);

var io = socketIO.listen(app);
io.sockets.on('connection', function(socket) {

    const doLog = true;

    // convenience function to log server messages on the client
    function maybeLog() {

        if (doLog) {

            var array = ['Message from server:'];
            array.push.apply(array, arguments);
            socket.emit('log', array);

        }
    }

    socket.on('message', function(message) {

        maybeLog('Client said: ', message);

        // for a real app, would be room-only (not broadcast)
        socket.broadcast.emit('message', message);

    });

    socket.on('create or join', function(room) {

        maybeLog('Received request to create or join room ' + room);

        var clientsInRoom = io.sockets.adapter.rooms[room];
        var numClients = clientsInRoom ? Object.keys(clientsInRoom.sockets).length : 0;

        maybeLog('Room ' + room + ' now has ' + numClients + ' client(s)');

        if (numClients === 0) {

            socket.join(room);

            maybeLog('Client ID ' + socket.id + ' created room ' + room);

            socket.emit('created', room, socket.id);

        } else if (numClients === 1) {

            maybeLog('Client ID ' + socket.id + ' joined room ' + room);

            io.sockets.in(room).emit('join', room);
            socket.join(room);
            socket.emit('joined', room, socket.id);

            io.sockets.in(room).emit('ready');

        } else { // max two clients

            socket.emit('full', room);

        }

    });

    socket.on('bye', function() {

        console.log('received bye');

    });

});