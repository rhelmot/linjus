(function(){
function makeCallback(f) {
	var m = curproc;
	return function () {
		curproc = m;
		f.apply(this, arguments);
	}
}

function write(s) {
	if (s == '') {
		return;
	}
	divthing.innerHTML += escapeHtml(s);
	lwc = s[s.length-1];
	divthing.scrollTop = divthing.scrollHeight;
}

var lwc = '';

function getLWC() {
	return lwc;
}

function readLine(callback) {
	if (linesready > 0) {
		callback(unloadLine());
	} else {
		linecallback = makeCallback(callback);
	}
}

function getEnv(k) {
	if (typeof k == 'undefined') {
		return myproc().env;
	} else {
		return myproc().env[k];
	}
}

function setEnv(k, v) {
	if (typeof v == 'undefined' && typeof k == 'object') {
		myproc().env = k;
	} else {
		myproc().env[k] = v;
	}
}

function unloadLine() {
	linesready--;
	var ret = keybuffer.indexOf('\n') + 1;
	var line = keybuffer.substr(0,ret);
	keybuffer = keybuffer.substr(ret);
	return line;
}

function backspace() {
	if (keybuffer.length == 0) {
		return;
	}
	var dc = escapeHtml(keybuffer[keybuffer.length-1]);
	keybuffer = keybuffer.substr(0,keybuffer.length-1);
	var mb = divthing.innerHTML;
	if (mb.substr(mb.length-dc.length)  == dc) {
		divthing.innerHTML = mb.substr(0, mb.length-dc.length);
	}
}

window.onload = function () {
	divthing = document.querySelector('div');
	document.onkeypress = function (e) {
		if (!pressreact) {
			return;
		}
		c = String.fromCharCode(e.charCode);
		if (e.charCode == 0 && e.keyCode == 13) {
			c = '\n';
		}
		if (c == '\r') c = '\n';
		write(c);
		keybuffer += c;
		if (c == '\n') {
			linesready++;
			if (typeof linecallback == 'function') {
				var callback = linecallback;
				linecallback = null;
				callback(unloadLine());
			}
		}
		e.preventDefault();
	};
	document.onkeydown = function (e) {
		//console.log(e);
		pressreact = false;
		if (e.which == 8) {
			backspace();
            e.preventDefault();
		} else {
			pressreact = true;
		}
	};
	document.onpaste = function (e) {
		var d = e.clipboardData.getData('text/plain');
		for (var i = 0; i < d.length; i++) {
			document.onkeypress({charCode: d.charCodeAt(i)});
		}
	};
	function parse_fs (node) {
		if (typeof node.owner == 'undefined') {
			node.owner = node.parent.owner;
		}
		if (typeof node.group == 'undefined') {
			node.group = node.parent.group;
		}
		if (node.type == 'DIR') {
			if (typeof node.perms == 'undefined') {
				node.perms = [[true, true, true], [true, false, true], [true, false, true]];
			}
			for (var i = 0; i < node.contents.length; i++) {
				node.contents[i].parent = node;
				parse_fs(node.contents[i]);
			}
		} else if (node.type == 'FILE') {
			if (typeof node.contents == 'object') {
				node.contents = initrd[node.contents[0]];
			}
			if (typeof node.perms == 'undefined') {
				node.perms = [[true, true, false], [true, false, false], [true, false, false]];
			}
		}
	}
	parse_fs(filesystem);
	filesystem.parent = filesystem;
	write("This is the birthday hacking terminal!\nTo list files, type ls and press enter.\nTo read files, type cat, a space, then the filename, and then press enter.\n\n");
	myproc().uid = 1;
	myproc().gid = 1;
	myproc().pwd = resolvePath(['/home/birthdayboy']);
	exec('bash', ['bash'], {HOSTNAME: 'birthdaybox', PATH: "/bin", HOME: "/home/birthdayboy", USERNAME: 'birthdayboy', PWD: '/home/birthdayboy'}, function () {
		//window.close();
	});
}

var exec = function (name, args, env, callback) {
	if (args.length == 0) {
		write('Need nonzero number of args');
		callback(-5);
		return;
	}
	if (name.indexOf('/') != -1) {
		file = resolvePath([name]);
	} else {
		if (!myproc().env.PATH) myproc().env.PATH = '';
		var pieces = myproc().env.PATH.split(':');
		for (var i = 0; i < pieces.length; i++) {
			file = resolvePath([pieces[i], name]);
			if (file.type != 'ERROR') {
				break;
			}
		}
	}
	if (file.type == 'ERROR') {
		write(file.message + '\n');
		callback(-1);
		return;
	}
	if (file.type != 'FILE') {
		write('Could not execute ' + name + ': Not a file\n');
		callback(-2);
		return;
	}
	if (!_checkPerms(file, 2)) {
		write('Could not execute ' + name + ': Not executable\n');
		callback(-3);
	}
	lastproc++;
	var oldproc = myproc();
	callback = makeCallback(callback);
	curproc = lastproc;
	proc[curproc] = {
		excutable: _realpath(file),
		cmdline: args.join(' '),
		uid: oldproc.uid,
		gid: oldproc.gid,
		callback: callback,
		env: env,
		pid: curproc,
		pwd: oldproc.pwd
	};
	try {
		var e = new Function('arguments = arguments[0];\n' + file.contents);
		with (donotoverwrite) {
			e.apply(curproc, [args]);
		}
	} catch (e) {
		console.log(e);
		write('Exec error: ' + e.toString());
		callback(-4);
	}
};

var sys_exit = function (i) {
	callback = myproc().callback;
	proc[curproc] = undefined;
	callback(i);
}

var checkPerms = function (d, perm) {
	var file = resolvePath(d);
	if (file.type == "ERROR") {
		file = resolvePath(d.split('/').slice(0,-1).join('/'));
		if (perm != 1 || file.type == 'ERROR') {
			write('No such file: ' + d + '\n');
			return false;
		}
	}
	return _checkPerms(file, perm);
};

var writeFile = function(d, data) {
	var file = resolvePath(d);
	if (file.type == "ERROR") {
		file = resolvePath(d.split('/').slice(0,-1).join('/'));
		if (file.type != "DIR") {
			write('No such file: ' + d + '\n');
			return false;
		}
		if (!_checkPerms(file, 1)) {
			write('Write access denied: ' + d + '\n');
			return false;
		}
		file.contents[file.contents.length] = {type: "FILE", name: d.split('/')[d.split('/').length-1], owner: myproc().user, group: myproc().group, parent: file, contents: data, perms: file.perms};
		return true;
	}
	if (!_checkPerms(file, 1)) {
		write('Write access denied: ' + d + '\n');
		return false;
	}
	file.contents = data;
	return true;
};

var _checkPerms = function (file, perm) {
	if (myproc().uid == 0 && perm != 2) {
		return true;
	}
	if (file.owner == myproc().uid && file.perms[0][perm]) {
		return true;
	}
	if (file.group == myproc().gid && file.perms[1][perm]) {
		return true;
	}
	return file.perms[2][perm];
};

var resolvePath = function (pieces) {
	if (typeof pieces == 'string') {
		if (pieces == '') pieces = '.';
		pieces = [pieces];
	}
	var file = myproc().pwd;
	for (var i = 0; i < pieces.length; i++) {
		if (pieces[i][pieces[i].length-1] == '/') {
			pieces[i] = pieces[i].substr(0,pieces[i].length-1);
		}
		var ppieces = pieces[i].split('/');
		for (var j = 0; j < ppieces.length; j++) {
			if (file.type != 'DIR') {
				return {type: 'ERROR', message: 'Could not navigate from ' + file.name + ': Not a directory'};
			}
			if (ppieces[j] == '') {
				file = filesystem;
			} else if (ppieces[j] == '.') {
				file = file;
			} else if (ppieces[j] == '..') { 
				file = file.parent;
			} else {
				var found = false;
				for (var k = 0; k < file.contents.length; k++) {
					if (file.contents[k].name == ppieces[j]) {
						found = true;
						file = file.contents[k];
						break;
					}
				}
				if (!found) {
					return {type: 'ERROR', message: 'No such file "' + ppieces[j] + '"'};
				}
			}
		}
	}
	return file;
};

function listdir(d) {
	var file = resolvePath([d]);
	if (file.type == 'ERROR') {
		write('No such file: ' + d + '\n');
		return false;
	} else if (file.type == 'FILE') {
		return [file.name];
	} else if (file.type == 'DIR') {
		if (!_checkPerms(file, 0)) {
			write('Access denied: ' + d + '\n');
			return false;
		}
		var out = ['.', '..'];
		for (var i = 0; i < file.contents.length; i++) {
			out[out.length] = file.contents[i].name;
		}
		return out;
	}
	return false;
}

function readfile(d) {
	var file = resolvePath([d]);
	if (file.type == 'ERROR') {
		write('No such file: ' + d + '\n');
		return false;
	} else if (file.type == 'DIR') {
		write('Is a directory: ' + d + '\n');
		return false;
	} else if (file.type == 'FILE') {
		if (!_checkPerms(file, 0)) {
			write('Access denied: ' + d + '\n');
			return false;
		}
		return file.contents;
	}
}

function chdir(d) {
	var file = resolvePath([d]);
	if (file.type == 'ERROR') {
		write('No such file: ' + d + '\n');
		return false;
	} else if (file.type == 'FILE') {
		write('Is a directory: ' + d + '\n');
		return false;
	} else if (file.type == 'DIR') {
		if (!_checkPerms(file, 0)) {
			write('Access denied: ' + d + '\n');
			return false;
		}
		myproc().pwd = file;
		myproc().env.PWD = _realpath(file);
	}
	return false;
}

function realpath(d) {
	var file = resolvePath([d]);
	if (file.type == 'ERROR') {
		write('No such file: ' + d + '\n');
		return false;
	}
	return _realpath(file);
}

function _realpath(file) {
	out = [file.name];
	while (file !== filesystem) {
		file = file.parent;
		out[out.length] = file.name;
	}
	out.reverse();
	return out.join('/');
}

filesystem = {
	name: '',
	type: 'DIR',
	owner: 0,
	group: 0,
	contents: [
		{
			name: 'bin',
			type: 'DIR',
			contents: [
				{
					name: 'bash',
					type: 'FILE',
					perms: [[true, true, true], [true, false, true], [true, false, true]],
					contents: ['bash']
				},
				{
					name: 'echo',
					type: 'FILE',
					perms: [[true, true, true], [true, false, true], [true, false, true]],
					contents: ['echo']
				},
				{
					name: 'ls',
					type: 'FILE',
					perms: [[true, true, true], [true, false, true], [true, false, true]],
					contents: ['ls']
				},
				{
					name: 'cat',
					type: 'FILE',
					perms: [[true, true, true], [true, false, true], [true, false, true]],
					contents: ['cat']
				},
				{
					name: 'pwd',
					type: 'FILE',
					perms: [[true, true, true], [true, false, true], [true, false, true]],
					contents: ['pwd']
				},
				{
					name: 'id',
					type: 'FILE',
					perms: [[true, true, true], [true, false, true], [true, false, true]],
					contents: ['id']
				},
				{
					name: 'true',
					type: 'FILE',
					perms: [[true, true, true], [true, false, true], [true, false, true]],
					contents: ['true']
				},
				{
					name: 'write',
					type: 'FILE',
					perms: [[true, true, true], [true, false, true], [true, false, true]],
					contents: ['write']
				},
				{
					name: 'birthday',
					type: 'FILE',
					perms: [[true, true, true], [true, false, true], [true, false, true]],
					contents: ['birthday']
				}
			]
		},
		{
			name: 'home',
			type: 'DIR',
			contents: [
				{
					name: 'birthdayboy',
					owner: 1,
					group: 1,
					type: 'DIR',
					contents: [
						{
							name: 'hint1',
							type: 'FILE',
							contents: ['hint1']
						},
						{
							name: 'hint2',
							type: 'FILE',
							contents: ['hint2']
						},
						{
							name: 'hint3',
							type: 'FILE',
							contents: ['hint3']
						},
						{
							name: 'hint4',
							type: 'FILE',
							contents: ['hint4']
						},
						{
							name: 'hint5',
							type: 'FILE',
							contents: ['hint5']
						},
						{
							name: 'hint6',
							type: 'FILE',
							contents: ['hint6']
						},
						{
							name: 'hint7',
							type: 'FILE',
							contents: ['hint7']
						}
					]
				}
			]
		},
		{
			name: 'etc',
			type: 'DIR',
			contents: [
				{
					name: 'cake1',
					type: 'FILE',
					contents: ['smallcake']
				},
				{
					name: 'cake2',
					type: 'FILE',
					contents: ['largecake']
				}
			]
		}
	]
}

curproc = 0;
lastproc = 0;
proc = [{
	executable: '',
	cmdline: 'init',
	uid: 0,
	gid: 0,
	pwd: filesystem,
	env: {PATH: '/bin', HOSTNAME: 'birthdaybox'},
	pid: 0
}];
function myproc() {
	return proc[curproc];
}

linecallback = null;
linesready = 0;
keybuffer = '';
divthing = null;
pressreact = true;

var entityMap = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
};

function escapeHtml(string) {
	return String(string).replace(/[&<>]/g, function (s) {
		return entityMap[s];
	});
}

syscalls = {
	read: readLine,
	write: write,
	exec: exec,
	getLWC: getLWC,
	exit: sys_exit,
	getEnv: getEnv,
	log: console.log,
	listdir: listdir,
	readfile: readfile,
	realpath: realpath,
	chdir: chdir,
	checkPerms: checkPerms,
	writeFile: writeFile
}

donotoverwrite = {window: null};
for (prop in window) {
	donotoverwrite[prop] = null;
}
donotoverwrite.syscalls = {};
for (prop in syscalls) {
	donotoverwrite.syscalls[prop] = syscalls[prop].bind({});
}
donotoverwrite.JSON = JSON;

})();
