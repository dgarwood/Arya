/**
 * Arya: Automatic Recorder of Your Activity.
 * Copyright (C) 2012 Jon Crussell
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const APPMENU_ICON_SIZE = 22;

const DEBUG_METHOD_CALL = false;
const DEBUG_FILE_LOAD = true;

const TIME_TRACK_WORKSPACES = true;
const TIME_TRACK_APPS = true;
const TIME_TRACK_PROJECTS = true;

/**
 * TODO:
 * * Save/Load to/from a file
 * * Add interface to see pretty graphs over time
 * * Doesn't work if number of workspaces changes after starting the extension
 * * Dont count idle time
 * * Break time according to day, week, month...
 * * Introduce mapping from applications/workspaces to projects
 */

function init() {
  return new ActivityRecorder();
}

const ActivityRecorder = new Lang.Class({
	Name: 'ActivityRecorder',
	Extends: PanelMenu.Button,

	_init: function() {
		if (DEBUG_METHOD_CALL) log("_init()");

		// File with description of projects
		this.fileProjectsPath = GLib.get_home_dir() + "/.ayra.projects";

		// File with statistics
		this.fileStatsPath = GLib.get_home_dir() + "/.ayra.stats";

		// Setup the menu button
		PanelMenu.Button.prototype._init.call(this, St.Align.START);

		this.button = new St.Bin({
			style_class: 'panel-button',
			reactive: true,
			can_focus: true,
			x_fill: true,
			y_fill: false,
			track_hover: true
		});

		let icon = new St.Icon({
			icon_name: 'system-run',
			// icon_type: St.IconType.SYMBOLIC,
			style_class: 'system-status-icon',
			width: 50
		});

		this.button.set_child(icon);
		this.actor.add_actor(this.button);

		// Refresh the menu (with updated times) every time it opens
		this.menu.connect('open-state-changed', Lang.bind(this, this._onMenuOpenStateChanged));

		Main.panel.addToStatusArea('arya', this);

		this._swap_time = -1;
		this._reset();

		Main.sessionMode.connect('updated', Lang.bind(this, this._onSessionModeUpdated));
		this._onSessionModeUpdated();
	},

	_reset: function() {
		if (DEBUG_METHOD_CALL) log("_reset()");

		// Load project definitions
		this._loadProjects();

		// Load project definitions
		this._loadStatistics();

		// Time spent in certain applications
		this._usage = {};

		// Tracking time spent in a single workspace
		this._workspaceTime = [];
		for(let i = 0; i < global.screen.n_workspaces; i++) {
			this._workspaceTime[i] = 0;
		}

		// Time spent on certain projects
		this._projects = {};

		// Record current time for metering
		this._swap_time = Date.now();

		// Record time when measurement started
		this.start_time = new Date();

		this._refreshMenu();
	},

	_loadProjects: function() {
		if (DEBUG_METHOD_CALL) log("_loadProjects()");

		if (DEBUG_FILE_LOAD) log("Opening project defintion file " + this.fileProjectsPath);

		let content = Shell.get_file_contents_utf8_sync(this.fileProjectsPath);
		let lines = content.toString().split('\n');

		let ignores = false;

		this.mapWindowTitleToProject = {}
		this.mapWindowTitleToProjectSequence = []
		this.windowTitlesToIgnore = []

		let project = "Undefined";

		// Parse file
		for (let i=0; i<lines.length; i++) {

			// Skip empty lines
			if (lines[i] == '' || lines[i] == '\n' || lines[i][0] == '#') {
				if (DEBUG_FILE_LOAD) log("Skipping empty line/comment (" + lines[i] + ')');
				continue;
			}

			// Are we at the ignore regex-es?
			if (lines[i] == ':windowTitlesToIgnore') {
				if (DEBUG_FILE_LOAD) log("Switching to ignores (" + lines[i] + ")");
				ignores = true;
				continue;
			}

			if (ignores) {
				if (DEBUG_FILE_LOAD) log("Adding new ignore RE (" + lines[i].substr(1) + ")");
				this.windowTitlesToIgnore.push(lines[i].substr(1));
				continue;
			}

			if (lines[i][0] == ':') {
				if (DEBUG_FILE_LOAD) log("Adding new project definition (" + lines[i].substr(1) + ")");
				project = lines[i].substr(1);
				this.mapWindowTitleToProject[project] = [];
				this.mapWindowTitleToProjectSequence.push(project);
				continue;
			}

			if (DEBUG_FILE_LOAD) log("Adding new RE for the current project definition (" + lines[i].substr(1) + ")");
			this.mapWindowTitleToProject[project].push(lines[i].substr(1));
		}

		if (DEBUG_FILE_LOAD) log("this.mapWindowTitleToProject=" + this.mapWindowTitleToProject + "\n"
				+ "this.mapWindowTitleToProjectSequence=" + this.mapWindowTitleToProjectSequence + "\n"
				+ "this.windowTitlesToIgnore=" + this.windowTitlesToIgnore);
	},

	_reloadProjects: function() {
		this._loadProjects();
		this._updateState();
	},

	_loadStatistics: function() {
		if (DEBUG_METHOD_CALL) log("_loadStatistics()");

	},

	// Update the current app and touch the swap time
	_updateState: function() {
		if (DEBUG_METHOD_CALL) log("_updateState()");

		// Before updating record current time if there is time
		if (this._swap_time != -1)
			this._recordTime();

		this._curr_app = this._getCurrentAppId();
		this._curr_workspace = global.screen.get_active_workspace().index();

		this._curr_project = null;
		let win = global.display.focus_window;
		if (win != null && !this.ignoreWindowTitle(win.title)) {
			this._curr_project = this.mapWindowTitleToProjectFunc(win.title);
			// log("New project: " + this._curr_project);
		}
	},

	mapWindowTitleToProjectFunc: function(windowTitle) {
		if (DEBUG_METHOD_CALL) log("mapWindowTitleToProjectFunc(" + windowTitle + ")");

                for(let i = 0; i < this.mapWindowTitleToProjectSequence.length; i++) {
			let project = this.mapWindowTitleToProjectSequence[i];
			let regexes = this.mapWindowTitleToProject[project];

			for(let j = 0; j < regexes.length; j++) {
				if (windowTitle.match(regexes[j])) {
					// log(project);
					return project;
				}
			}
		};

		return windowTitle;
	},

	ignoreWindowTitle: function(windowTitle) {
		if (DEBUG_METHOD_CALL) log("ignoreWindowTitle("+ windowTitle + ")");

                for(let i = 0; i < this.windowTitlesToIgnore.length; i++) {
			if (windowTitle.match(this.windowTitlesToIgnore[i]))
				return true;
		};

		return false;
	},

	// Recalculate the menu which shows time for each app
	_refreshMenu: function() {
		if (DEBUG_METHOD_CALL) log("_refreshMenu");

		this._updateState();

		let menu = this.menu;
		menu.removeAll();

		let applicationsSubmenu = new PopupMenu.PopupSubMenuMenuItem('Applications', true);

		let usage = this._usage;
		let ids = Object.keys(usage).sort(function(x,y) { return (usage[y] - usage[x]) });

		let app_system = Shell.AppSystem.get_default();

		let count = 0;
		let total = 0;
		ids.forEach(function(id) {
			if(usage[id] < 1) return;
			let app = app_system.lookup_app(id);
			if (app) {
				let mins = Math.round(usage[id]);
				let icon = app.create_icon_texture(APPMENU_ICON_SIZE);
				let str = makeTimeStrFromMins(mins);
				applicationsSubmenu.menu.addMenuItem(new AppUsageMenuItem(icon, app.get_name(), str));
				count += 1; total += mins;
			}
		});

		if (ids.length > 0) {
			menu.addMenuItem(applicationsSubmenu);
		}

		let workspacesSubmenu = new PopupMenu.PopupSubMenuMenuItem('Workspaces', true);

		// Refresh workspace time
		for(let i = 0; i < global.screen.n_workspaces; i++) {
			let mins = Math.round(this._workspaceTime[i]);
			let str = makeTimeStrFromMins(mins);
			let workspaceName = Meta.prefs_get_workspace_name(i);
			workspacesSubmenu.menu.addMenuItem(new WorkspaceTimeMenuItem(workspaceName, str));
		};

		menu.addMenuItem(workspacesSubmenu);
		menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

		let projects = this._projects;
		let ids = Object.keys(projects);
		// log('ids = ' + ids.length);
		ids.forEach(function(id) {
			let mins = Math.round(projects[id]);
			let str = makeTimeStrFromMins(mins);
			// log('mins = ' + mins);
			// log('str = ' + str);
			menu.addMenuItem(new ProjectMenuItem(id, str));
		});

		if (ids.length > 0) {
			menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
		}
		menu.addMenuItem(new TotalUsageMenuItem(makeTimeStrFromMins(total)));
		menu.addMenuItem(new StartTimeMenuItem(this.start_time.toString().substr(4,20)));

		// FIXME: This is temporary until UI is defined to
		//        enter project definitions
		let item = new PopupMenu.PopupMenuItem(_("Reload definitions"));
		item.connect('activate', Lang.bind(this, this._reloadProjects));
		menu.addMenuItem(item);

		let item = new PopupMenu.PopupMenuItem(_("Clear History"));
		item.connect('activate', Lang.bind(this, this._reset));
		menu.addMenuItem(item);
 
	},
 
	// Callback for when app focus changes
	_onFocusChanged: function() {
		if (DEBUG_METHOD_CALL) log("_onFocusChanged()");

		this._updateState();
	},

	_onSessionModeUpdated: function() {
		if (DEBUG_METHOD_CALL) log("_onSessionModeUpdated()");

		let inLockScreen = Main.sessionMode.isLocked;

		if (this.inLockScreen !== inLockScreen) {
			this.inLockScreen = inLockScreen;

			if (inLockScreen) {
				this._recordTime();
				this._curr_app = "Screen Saver";
				this._curr_workspace = -1;
				this._curr_project = "Screen Saver";
			} else {
				this._updateState();
			}
		}

	},

	// Callback for when the menu is opened or closed
	_onMenuOpenStateChanged: function(menu, isOpen) {
		if (DEBUG_METHOD_CALL) log("_onMenuOpenStateChanged(" + menu + ", " + isOpen + ")");

		if (isOpen) { // Changed from closed to open
			this._refreshMenu();
		}
	},

	// Get the current app or null
	_getCurrentAppId: function() {
		if (DEBUG_METHOD_CALL) log("_getCurrentAppId()");

		let tracker = Shell.WindowTracker.get_default();
		let focusedApp = tracker.focus_app;
		// Not an application window
		if(!focusedApp) {
			return null;
		}

		return focusedApp.get_id();
	},

	// Update the total time for the current app & workspace
	_recordTime: function() {
		if (DEBUG_METHOD_CALL) log("_recordTime()");

		let swap_time = this._swap_time;
		this._swap_time = Date.now();

		let mins = (this._swap_time - swap_time) / 1000 / 60;

		if (this._curr_app != null) {
			this._usage[this._curr_app] = (this._usage[this._curr_app] || 0) + mins;
		}

		this._workspaceTime[this._curr_workspace] += mins;

		if (this._curr_project != null) {
			this._projects[this._curr_project] = (this._projects[this._curr_project] || 0) + mins;
		}
	},

	enable: function() {
		if (DEBUG_METHOD_CALL) log("enable()");

		// Add menu to panel
		Main.panel._rightBox.insert_child_at_index(this.actor, 0);
		Main.panel.menuManager.addMenu(this.menu);

		// Connect to the tracker
		// let tracker = Shell.WindowTracker.get_default();
		// this._tracker_id = tracker.connect("notify::focus-window", Lang.bind(this, this._onFocusChanged));

		this._focusWindowNotifyId = global.display.connect('notify::focus-window',
				Lang.bind(this, this._onMenuOpenStateChanged));
	},

	disable: function() {
		if (DEBUG_METHOD_CALL) log("disable()");

		// Remove menu from panel
		Main.panel.menuManager.removeMenu(this.menu);
		Main.panel._rightBox.remove_actor(this.actor);

		// Remove tracker
		// let tracker = Shell.WindowTracker.get_default();
		// tracker.disconnect(this._tracker_id);

		global.display.disconnect(this._focusWindowNotifyId);
		this._focusWindowNotifyId = 0;
	}
});


/**
 * From: http://blog.fpmurphy.com/2011/05/more-gnome-shell-customization.html
 */
const AppUsageMenuItem = new Lang.Class({
	Name: 'AppUsageMenuItem',
	Extends: PopupMenu.PopupBaseMenuItem,

	_init: function(icon, text1, text2, params) {
		PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

		this._topBox = new St.BoxLayout();

		this.label1 = new St.Label({ text: text1, width: 300 });
		this.label2 = new St.Label({ text: text2, width: 100 });
		this.icon = icon;

		this._topBox.add(this.icon);
		this._topBox.add(this.label1);
		this._topBox.add(this.label2);

		this.actor.add(this._topBox);
	}
});

const WorkspaceTimeMenuItem = new Lang.Class ({
	Name: 'WorkspaceTimeMenuItem',
	Extends: PopupMenu.PopupBaseMenuItem,

	_init: function(text1, text2, params) {
		PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

		this._topBox = new St.BoxLayout();

		this.label1 = new St.Label({ text: text1, width: 300 });
		this.label2 = new St.Label({ text: text2, width: 100 });

		this._topBox.add(this.label1);
		this._topBox.add(this.label2);

		this.actor.add(this._topBox);
	}
});

const ProjectMenuItem = new Lang.Class({
	Name: 'ProjectMenuItem',
	Extends: PopupMenu.PopupBaseMenuItem,


	_init: function(text1, text2, params) {
		PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

		this._topBox = new St.BoxLayout();

		this.label1 = new St.Label({ text: text1, width: 300 });
		this.label2 = new St.Label({ text: text2, width: 150 });

		this._topBox.add(this.label1);
		this._topBox.add(this.label2);

		this.actor.add(this._topBox);
	}
});

const TotalUsageMenuItem = new Lang.Class({
	Name: 'TotalUsageMenuItem',
	Extends: PopupMenu.PopupBaseMenuItem,

	_init: function(time, params) {
		PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

		this._topBox = new St.BoxLayout();

		this.label1 = new St.Label({ text: "Total", width: 300 });
		this.label2 = new St.Label({ text: time,    width: 100 });

		this._topBox.add(this.label1);
		this._topBox.add(this.label2, { x_align: St.Align.END, });

		this.actor.add(this._topBox);
	}
});

const StartTimeMenuItem = new Lang.Class({
	Name: 'StartTimeMenuItem',
	Extends: PopupMenu.PopupBaseMenuItem,

	_init: function(time, params) {
		PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

		this._topBox = new St.BoxLayout();

		this.label1 = new St.Label({ text: "Start time", width: 250 });
		this.label2 = new St.Label({ text: time,    width: 150 });

		this._topBox.add(this.label1);
		this._topBox.add(this.label2, { x_align: St.Align.END, });

		this.actor.add(this._topBox);
	}
});

function makeTimeStrFromMins(mins) {

	if (mins > 60) { // Report usage in hours
		return Math.round(mins*100/60)/100 + " hours";
	}

	if (mins == 1) {
		return mins + " minute";
	} else {
		return mins + " minutes"
	}
}
