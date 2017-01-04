//express to serve files to users based on http request
var express = require('express');
var app = express();
var serv = require('http').Server(app);

app.get('/',function(req, res) {
	res.sendFile(__dirname + '/client/index.html');
});
app.use('/client',express.static(__dirname + '/client'));

serv.listen(2000);
console.log('Server started.');

//socket list for users
var SOCKET_LIST = {};

//object form superclass
var Entity = function(){
	var self = {
		x:250,
		y:250,
		spdX:0,
		spdY:0,
		id:""
	}
	self.update = function(){
		self.updatePosition();
	}
	self.updatePosition = function(){
		self.x += self.spdX;
		self.y += self.spdY;
	}
	self.getDistance = function(pt){
		return Math.sqrt(Math.pow(self.x-pt.x,2)+Math.pow(self.y-pt.y,2));
	}
	return self;
}

//object/constructor for a player
var Player = function(id){
	var self = Entity(); //inherit from base class
	self.id = id;
	self.number = "" + Math.floor(10 * Math.random());
	self.pressingRight = false;
	self.pressingLeft = false;
	self.pressingUp = false;
	self.pressingDown = false;
	self.pressingAttack = false;
	self.mouseAngle = 0;
	self.maxSpd = 10;

	//update super update() method
	var super_update = self.update;
	//@override old update
	self.update = function(){
		self.updateSpd(); //update speed
		super_update(); //call old update method

		//create bullet
		if(self.pressingAttack) {
			self.shootBullet(self.mouseAngle);
		}
	}

	//fire/instantiate bullet
	self.shootBullet = function(angle){
		var b = Bullet(angle);
		b.x = self.x;
		b.y = self.y;
	}

	//update speed based on keypress
	self.updateSpd = function(){
		if(self.pressingRight)
			self.spdX = self.maxSpd;
		else if(self.pressingLeft)
			self.spdX = -self.maxSpd;
		else
			self.spdX = 0;

		if(self.pressingUp)
			self.spdY = -self.maxSpd;
		else if(self.pressingDown)
			self.spdY = self.maxSpd;
		else
			self.spdY = 0;
	}
	Player.list[id] = self; // add to static list
	return self;
}
//initialize static player list
Player.list = {};
//static on connect function that handles connecting a player
Player.onConnect = function(socket){
	//create a player with the id
	var player = Player(socket.id);
	//listen to keypress events and update player accordingly
	socket.on('keyPress',function(data){
		if(data.inputId === 'left')
			player.pressingLeft = data.state;
		else if(data.inputId === 'right')
			player.pressingRight = data.state;
		else if(data.inputId === 'up')
			player.pressingUp = data.state;
		else if(data.inputId === 'down')
			player.pressingDown = data.state;
		else if(data.inputId === 'attack')
			player.pressingAttack = data.state;
		else if(data.inputId === 'mouseAngle')
			player.mouseAngle = data.state;
	});
}

//handle player diconnection
Player.onDisconnect = function(socket) {
	delete Player.list[socket.id];
}

//updating the player
Player.update = function() {
	var pack = []; //package (list) of all on screen data

	//loop through each socket in socket list
	for(var i in Player.list) {
		var player = Player.list[i];
		player.update();
		pack.push({
			x:player.x,
			y:player.y,
			number:player.number,
			id:player.id,
		});
	}
	//return pack to be used for emission to client
	return pack;
}

//bullet class
var Bullet = function(parent,angle){
	var self = Entity();
	self.id = Math.random();
	self.spdX = Math.cos(angle/180 * Math.PI) * 10;
	self.spdY = Math.sin(angle/180 * Math.PI) * 10;
	self.parent = parent; //so bullet will not kill parent
	self.timer = 0;
	self.toRemove = false;

	//@override superclass update function
	var super_update = self.update;
	self.update = function(){
		if(self.timer++ > 100) {
			self.toRemove = true;
		}
		super_update();
	}

	Bullet.list[self.id] = self;
	return self;
}
Bullet.list = {}; //bulet dictionary

//updating the bullet
Bullet.update = function() {
	var pack = []; //package (list) of all on screen data

	//loop through each socket in socket list
	for(var i in Bullet.list) {
		var bullet = Bullet.list[i];
		bullet.update();
		pack.push({
			x:bullet.x,
			y:bullet.y,
		});

		//remove bullet if necessary
		if(bullet.toRemove) delete Bullet.list[i];
	}
	//return pack to be used for emission to client
	return pack;
}

//debug flag
var DEBUG = true;

//socket io handling messaging between client + server 
var io = require('socket.io')(serv,{}); //setting up an io object for our server
io.sockets.on('connection', function(socket) {
	console.log('socket connected boi');

	socket.id = Math.random(); //unique id for socket
	//emit the id
	socket.emit('idEmitted',socket.id);

	SOCKET_LIST[socket.id] = socket; //add to the list of sickets, hashmap

	//initialize the player in the connection
	Player.onConnect(socket);

	//listen for clients that disconnect
	socket.on('disconnect', function() {
		delete SOCKET_LIST[socket.id];
		Player.onDisconnect(socket);
	});

	//listen for chat events
	socket.on('sendMsgToServer', function(data) {
		var playerName = ("" + socket.id).slice(2,7);
		//to each socket(player) emit this new message
		for(var i in SOCKET_LIST) {
			SOCKET_LIST[i].emit('addToChat', playerName + ': ' + data);
		}
	});

	//listen for server eval events
	socket.on('evalServer', function(data) {
		if(!DEBUG) return; //check debug flag

		var result = eval(data);
		//only emit to socket that quieried it
		socket.emit('evalAnswer',result);
	});

});

//looping poll, 25 fps, or ever 40 ms
setInterval(function(){
	//json packet with updated player and bullet positions
	var pack = {
		player:Player.update(),
		bullet:Bullet.update(),
	}

	//send out data to all players
	for(var i in SOCKET_LIST) {
		var socket = SOCKET_LIST[i];
		socket.emit('newPositions',pack);
	}

},1000/25);
