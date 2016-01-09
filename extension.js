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

const DEBUG_METHOD_CALL = true;
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

function ActivityRecord() {
	if (DEBUG_METHOD_CALL) log("new ActivityRecord()");

	this.init();
}

ActivityRecord.prototype.init = function() {
	if (DEBUG_METHOD_CALL) log("ActivityRecord.init()");

	// When this structure has been created
	this.created = new Date();

	// Hash indexed by app - how much time was spent in each
	// application during the course of this. The value of
	// each element is a cumulative time.
	this.appUsageStat = {};

	// List of pairs. Each pair has two elements, the applicatoin name
	// and the time the application was activated. This is used to have
	// a complete history of all used applications
	this.appUsageHist = [];

	// These are data structures similar to appUsage* but they keep
	// window titles instead of application names
	this.windowUsageStat = {};
	this.windowUsageHist = [];

	// These are data structures similar to appUsage* but they keep
	// workspace names instead of application names
	this.workspaceUsageStat = {};
	this.workspaceUsageHist = [];

	// These are data structures similar to appUsage* but they keep
	// projects instead of application names.
	//
	// These structures are generated dynamically from the
	// this.windowUsage* data
	this.projectUsageStat = {};
	this.projectUsageHist = [];

	// Initialize REs for mapping window titles to projects and REs
	// to ignore certain windows.
	this.loadProjectDefs(GLib.get_home_dir() + "/.arya_settings.json");

	// We are not in the paused state
	this.pause = false;

	// Populate initial values into attributes
	let now = new Date();

	let curr_app = this._getCurrentAppId();
	this.appUsageStat[curr_app] = 0;
	this.appUsageHist.push([now, curr_app]);

	let curr_workspace_idx = global.screen.get_active_workspace().index();
	let curr_workspace = Meta.prefs_get_workspace_name(curr_workspace_idx);
	this.workspaceUsageStat[curr_workspace] = 0;
	this.workspaceUsageHist.push([now, curr_workspace]);

	let win = global.display.focus_window;
	let title = "-1";
	if (win != null)
		title = win.title;

	this.windowUsageStat[title] = 0;
	this.windowUsageHist.push([now, title]);

	let project = "Ignored window";
	if (!this.ignoreWindowTitle(title))
		project = this.mapWindowTitleToProjectFunc(title);
		
	this.projectUsageStat[project] = 0;
	this.projectUsageHist.push([now, project]);
};

ActivityRecord.prototype.update = function() {
	if (DEBUG_METHOD_CALL) log("ActivityRecord.update()");

	if (this.paused)
		return;

	let now = new Date();

	// Update current application data.
	// If current application didn't change don't touch anything
	let curr_app = this._getCurrentAppId();
	let lastAppName = this.appUsageHist[this.appUsageHist.length - 1][1];
	if (curr_app != lastAppName) {
		let lastAppStartTime = this.appUsageHist[this.appUsageHist.length - 1][0];
		this.appUsageStat[lastAppName] += (now - lastAppStartTime);

		if (!this.appUsageStat[curr_app])
			this.appUsageStat[curr_app] = 0;

		this.appUsageHist.push([now, curr_app]);
	}

	// Update current workspace data.
	// If current workspace didn't change don't touch anything

	let curr_workspace_idx = global.screen.get_active_workspace().index();
	let curr_workspace = Meta.prefs_get_workspace_name(curr_workspace_idx);
	let lastWorkspaceName = this.workspaceUsageHist[this.workspaceUsageHist.length - 1][1];
	if (curr_workspace != lastWorkspaceName) {
		let lastWorkspaceStartTime = this.workspaceUsageHist[this.workspaceUsageHist.length - 1][0];
		this.workspaceUsageStat[lastWorkspaceName] += (now - lastWorkspaceStartTime);

		if (!this.workspaceUsageStat[curr_workspace])
			this.workspaceUsageStat[curr_workspace] = 0;

		this.workspaceUsageHist.push([now, curr_workspace]);
	}

	// Update current window data.
	let win = global.display.focus_window;
	let curr_title = "-1";
	if (win != null) {
		curr_title = win.title;
	}

	// If current window didn't change don't touch anything
	let lastWindowTitle = this.windowUsageHist[this.windowUsageHist.length - 1][1];
	if (curr_title != lastWindowTitle) {
		let lastWindowTitleStartTime = this.windowUsageHist[this.windowUsageHist.length - 1][0];
		this.windowUsageStat[lastWindowTitle] += (now - lastWindowTitleStartTime);

		if (!this.windowUsageStat[curr_title])
			this.windowUsageStat[curr_title] = 0;

		this.windowUsageHist.push([now, curr_title]);
	}

	if (!this.ignoreWindowTitle(curr_title)) {
		let curr_project = this.mapWindowTitleToProjectFunc(curr_title);

		// If current project didn't change don't touch anything
		let lastProject = this.projectUsageHist[this.projectUsageHist.length - 1][1];
		if (curr_project != lastProject) {
			let lastProjectStartTime = this.projectUsageHist[this.projectUsageHist.length - 1][0];
			this.projectUsageStat[lastProject] += (now - lastProjectStartTime);

			if (!this.projectUsageStat[curr_project])
				this.projectUsageStat[curr_project] = 0;

			this.projectUsageHist.push([now, curr_project]);
		}
	} else {
		if (this.projectUsageHist[this.projectUsageHist.length - 2][1] == "PAUSED") {

			// It might happen that we were paused when the window to ignore
			// was active and when we resume, if this window is still active,
			// we'll end up in the project that there will be not tracked.
			// In that case we have to take the last running window!
			let lastProject = this.projectUsageHist[this.projectUsageHist.length - 2][1];
			this.projectUsageHist.push([now, lastProject]);

		}
	}
};

ActivityRecord.prototype.getStats = function() {
	if (DEBUG_METHOD_CALL) log("ActivityRecord.getStats()");

	let result = {};

	let now = new Date();

	result["apps"] = {};
	if (this.appUsageHist.length > 0) {
		let last_app = this.appUsageHist[this.appUsageHist.length - 1][1]
		let last_start_time = this.appUsageHist[this.appUsageHist.length - 1][0]
		for (var x in this.appUsageStat)
			result["apps"][x] = this.appUsageStat[x];
		result["apps"][last_app] += (now - last_start_time);
	}

	result["workspaces"] = {};
	let last_workspace = this.workspaceUsageHist[this.workspaceUsageHist.length - 1][1]
	let last_start_time = this.workspaceUsageHist[this.workspaceUsageHist.length - 1][0]
	for (var x in this.workspaceUsageStat)
		result["workspaces"][x] = this.workspaceUsageStat[x];
	result["workspaces"][last_workspace] += (now - last_start_time);

	result["windows"] = {};
	if (this.windowUsageHist.length > 0) {
		let last_window = this.windowUsageHist[this.windowUsageHist.length - 1][1]
		let last_start_time = this.windowUsageHist[this.windowUsageHist.length - 1][0]
		for (var x in this.windowUsageStat)
			result["windows"][x] = this.windowUsageStat[x];
		result["windows"][last_window] += (now - last_start_time);
	}

	result["projects"] = {};
	if (this.projectUsageHist.length > 0) {
		let last_project = this.projectUsageHist[this.projectUsageHist.length - 1][1];
		let last_start_time = this.projectUsageHist[this.projectUsageHist.length - 1][0];
		for (var x in this.projectUsageStat)
			result["projects"][x] = this.projectUsageStat[x];
		result["projects"][last_project] += (now - last_start_time);
	}

	print(JSON.stringify(result));

	return result;
};

ActivityRecord.prototype.pause = function() {
	if (DEBUG_METHOD_CALL) log("ActivityRecord.pause()");

	let now = new Date();

	// Update current application data.
	// If current application didn't change don't touch anything
	let lastAppName = this.appUsageHist[this.appUsageHist.length - 1][1];
	let lastAppStartTime = this.appUsageHist[this.appUsageHist.length - 1][0];
	this.appUsageStat[lastAppName] += (now - lastAppStartTime);

	if (!this.appUsageStat["PAUSED"])
		this.appUsageStat[PAUSED] = 0;

	this.appUsageHist.push([now, "PAUSED"]);

	let lastWorkspaceName = this.workspaceUsageHist[this.workspaceUsageHist.length - 1][1];
	let lastWorkspaceStartTime = this.workspaceUsageHist[this.workspaceUsageHist.length - 1][0];
	this.workspaceUsageStat[lastWorkspaceName] += (now - lastWorkspaceStartTime);

	if (!this.workspaceUsageStat["PAUSED"])
		this.workspaceUsageStat["PAUSED"] = 0;

	this.workspaceUsageHist.push([now, "PAUSED"]);

	let lastWindowTitle = this.windowUsageHist[this.windowUsageHist.length - 1][1];
	let lastWindowTitleStartTime = this.windowUsageHist[this.windowUsageHist.length - 1][0];
	this.windowUsageStat[lastWindowTitle] += (now - lastWindowTitleStartTime);

	if (!this.windowUsageStat["PAUSED"])
		this.windowUsageStat["PAUSED"] = 0;

	this.windowUsageHist.push([now, "PAUSED"]);

	let lastProject = this.projectUsageHist[this.projectUsageHist.length - 1][1];
	let lastProjectStartTime = this.projectUsageHist[this.projectUsageHist.length - 1][0];
	this.projectUsageStat[lastProject] += (now - lastProjectStartTime);

	if (!this.projectUsageStat["PAUSED"])
		this.projectUsageStat["PAUSED"] = 0;

	this.projectUsageHist.push([now, "PAUSED"]);

	this.paused = true;
};

// Resume recording
ActivityRecord.prototype.resume = function() {
	if (DEBUG_METHOD_CALL) log("ActivityRecord.resume()");

	this.paused = false;
	this.update();
};

// Get the current app or "-1" if none focused
ActivityRecord.prototype._getCurrentAppId = function() {
	if (DEBUG_METHOD_CALL) log("ActivityRecord._getCurrentAppId()");

	let tracker = Shell.WindowTracker.get_default();
	let focusedApp = tracker.focus_app;
	// Not an application window
	if(!focusedApp) {
		return "-1";
	}

	return focusedApp.get_id();
};

ActivityRecord.prototype.saveToFile = function(filename) {
	if (DEBUG_METHOD_CALL) log("ActivityRecord.saveToFile(" + filename + ")");

	let f = Gio.file_new_for_path(filename);
	let out = f.replace(null, false, Gio.FileCreateFlags.NONE, null);

	let fileContent = {
			"appUsageStat": this.appUsageStat,
			"appUsageHist": this.appUsageHist,
			"windowUsageStat": this.windowUsageStat,
			"windowUsageHist": this.windowUsageHist,
			"workspaceUsageStat": this.workspaceUsageStat,
			"workspaceUsageHist": this.workspaceUsageHist,
			"projectUsageStat": this.projectUsageStat,
			"projectUsageHist": this.projectUsageHist,
		};

	Shell.write_string_to_stream (out, JSON.stringify(fileContent));
	out.close(null);
}

ActivityRecord.prototype.loadFromFile = function(filename) {
	if (DEBUG_METHOD_CALL) log("ActivityRecord.loadFromFile(" + filename + ")");

	let content = Shell.get_file_contents_utf8_sync(filename);
	let objParsed = JSON.parse(content);

	this.init();

	// Parse application usage and history
	while (objParsed.appUsageHist.length > 0) {
		let elem = objParsed.appUsageHist.shift();
		this.appUsageHist.push([new Date(elem[0]), elem[1]]);
	}

	for (var idx in objParsed.appUsageStat)
		this.appUsageStat[idx] = objParsed.appUsageStat[idx];

	// Parse window usage and history
	while (objParsed.windowUsageHist.length > 0) {
		let elem = objParsed.windowUsageHist.shift();
		this.windowUsageHist.push([new Date(elem[0]), elem[1]]);
	}

	for (var idx in objParsed.windowUsageStat)
		this.windowUsageStat[idx] = objParsed.windowUsageStat[idx];

	// Parse workspace usage and history
	while (objParsed.workspaceUsageHist.length > 0) {
		let elem = objParsed.workspaceUsageHist.shift();
		this.workspaceUsageHist.push([new Date(elem[0]), elem[1]]);
	}

	for (var idx in objParsed.workspaceUsageStat)
		this.workspaceUsageStat[idx] = objParsed.workspaceUsageStat[idx];

	// Parse project usage and history
	while (objParsed.projectUsageHist.length > 0) {
		let elem = objParsed.projectUsageHist.shift();
		this.projectUsageHist.push([new Date(elem[0]), elem[1]]);
	}

	for (var idx in objParsed.projectUsageStat)
		this.projectUsageStat[idx] = objParsed.projectUsageStat[idx];

	this.saveToFile(filename + '.bak');
}


ActivityRecord.prototype.loadProjectDefs = function(filename) {
	if (DEBUG_METHOD_CALL) log("ActivityRecord.loadProjectDefs(" + filename + ")");

	if (DEBUG_FILE_LOAD) log("Opening project defintion file " + filename);

	let content = Shell.get_file_contents_utf8_sync(filename);
	let objParsed = JSON.parse(content);

	// If the file format isn't version supported by the plugin
	// ignore it. TODO: Report error!
	if (objParsed["formatVersion"] != "0.1")
		return;

	this.mapWindowTitleToProject = {}
	this.mapWindowTitleToProjectSequence = []
	this.windowTitlesToIgnore = []

	for (var x in objParsed["projects"])
		this.mapWindowTitleToProject[x] = objParsed["projects"][x];

	this.windowTitlesToIgnore = objParsed.ignores;
	this.mapWindowTitleToProjectSequence = objParsed.projectSeqeunce;

	if (DEBUG_FILE_LOAD)
		log("this.mapWindowTitleToProject=" + JSON.stringify(this.mapWindowTitleToProject) + "\n\n"
			+ "this.mapWindowTitleToProjectSequence=" + JSON.stringify(this.mapWindowTitleToProjectSequence) + "\n\n"
			+ "this.windowTitlesToIgnore=" + JSON.stringify(this.windowTitlesToIgnore) + "\n");
};

ActivityRecord.prototype.recalculateProjects = function() {
	this.projectUsageStat = {};
	this.projectUsageHist = [];

	for(let i = 0; i < this.windowUsageHist.length; i++) {

		let windowStartTime = this.windowUsageHist[i][0];
		let windowTitle = this.windowUsageHist[i][1];

		if (this.ignoreWindowTitle(windowTitle))
			continue;

		let curr_project = this.mapWindowTitleToProjectFunc(windowTitle);

		// If current project didn't change don't touch anything
		if (this.projectUsageHist.length == 0) {
			this.projectUsageHist.push([windowStartTime, curr_project]);
		} else {

			let lastProject = this.projectUsageHist[this.projectUsageHist.length - 1][1];

			if (curr_project == lastProject)
				continue;

			let lastProjectStartTime = this.projectUsageHist[this.projectUsageHist.length - 1][0];
			this.projectUsageStat[lastProject] += (windowStartTime - lastProjectStartTime);

			if (!this.projectUsageStat[curr_project])
				this.projectUsageStat[curr_project] = 0;

			this.projectUsageHist.push([now, curr_project]);
		}
	}
};

//	this.windowUsageStat[title] = 0;
//	this.windowUsageHist.push([now, title]);

ActivityRecord.prototype.mapWindowTitleToProjectFunc = function(windowTitle) {
	if (DEBUG_METHOD_CALL) log("ActivityRecord.mapWindowTitleToProjectFunc(" + windowTitle + ")");

	if (windowTitle == "-1")
		return "No Project Defined";

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

	return "No Project Defined";
};

ActivityRecord.prototype.ignoreWindowTitle = function(windowTitle) {
	if (DEBUG_METHOD_CALL) log("ActivityRecord.ignoreWindowTitle("+ windowTitle + ")");

	for(let i = 0; i < this.windowTitlesToIgnore.length; i++) {
		if (windowTitle.match(this.windowTitlesToIgnore[i]))
			return true;
	};

	return false;
};

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

		this.activityRecord = new ActivityRecord();

		Main.sessionMode.connect('updated', Lang.bind(this, this._onSessionModeUpdated));
		this._onSessionModeUpdated();
	},

	_reloadProjects: function() {
		this.activityRecord.loadProjectDefs(GLib.get_home_dir() + "/.arya_settings.json");
		this.activityRecord.recalculateProjects();
	},

	// Recalculate the menu which shows time for each app
	refreshMenu: function() {
		if (DEBUG_METHOD_CALL) log("ActivityRecorder.refreshMenu()");

		let stats = this.activityRecord.getStats();

		let menu = this.menu;
		menu.removeAll();

		///////////////////////////////////////////////////////////////
		// Create application submenu
		///////////////////////////////////////////////////////////////

		let applicationsSubmenu = new PopupMenu.PopupSubMenuMenuItem('Applications', true);

		let app_system = Shell.AppSystem.get_default();

		let appUsageStat = stats["apps"];

		let allApps = Object.keys(appUsageStat).sort();

		let count = 0;

		for (let i = 0; i < allApps.length; i++) {

			idx = allApps[i];

			if (idx == "-1")
				continue;

			let app = app_system.lookup_app(idx);
			if (app) {
				let mins = Math.round(appUsageStat[idx] / 1000 / 60);

				if (mins == 0)
					continue;

				let icon = app.create_icon_texture(APPMENU_ICON_SIZE);
				let str = makeTimeStrFromMins(mins);
				applicationsSubmenu.menu.addMenuItem(new AppUsageMenuItem(icon, app.get_name(), str));
				count += 1;
			}
		};

		if (count > 0) {
			menu.addMenuItem(applicationsSubmenu);
		}

		///////////////////////////////////////////////////////////////
		// Create workspaces submenu
		///////////////////////////////////////////////////////////////

		let workspacesSubmenu = new PopupMenu.PopupSubMenuMenuItem('Workspaces', true);

		let workspaceUsageStat = stats["workspaces"];

		// Refresh workspace time
		for(var idx in workspaceUsageStat) {
			let mins = Math.round(workspaceUsageStat[idx] / 1000 / 60);
			let str = makeTimeStrFromMins(mins);
			workspacesSubmenu.menu.addMenuItem(new WorkspaceTimeMenuItem(idx, str));
		};

		menu.addMenuItem(workspacesSubmenu);

		///////////////////////////////////////////////////////////////
		// Create window titles submenu
		///////////////////////////////////////////////////////////////

		let windowsSubmenu = new PopupMenu.PopupSubMenuMenuItem('Windows', true);

		let windowUsageStat = stats["windows"];

		let allWindows = Object.keys(windowUsageStat).sort();

		let count = 0;

		// Refresh workspace time
		for(let i = 0; i < allWindows.length; i++) {

			idx = allWindows[i];

			if (idx == "-1")
				continue;

			let mins = Math.round(windowUsageStat[idx] / 1000 / 60);

			if (mins == 0)
				continue;

			let str = makeTimeStrFromMins(mins);
			windowsSubmenu.menu.addMenuItem(new WorkspaceTimeMenuItem(idx, str));

			count++;
		};

		if (count > 0)
			menu.addMenuItem(windowsSubmenu);

		menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

		///////////////////////////////////////////////////////////////
		// Create project statistics
		///////////////////////////////////////////////////////////////

		let total = 0;
		let count = 0;

		let projectUsageStat = stats["projects"];
		let allProjects = Object.keys(projectUsageStat).sort();

		for(let i = 0; i < allProjects.length; i++) {
			idx = allProjects[i];

			let mins = Math.round(projectUsageStat[idx] / 1000 / 60);

			if (mins == 0)
				continue;

			let str = makeTimeStrFromMins(mins);
			menu.addMenuItem(new ProjectMenuItem(idx, str));
			total += mins;
			count++;
		};

		if (count > 0) {
			menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
		}

		///////////////////////////////////////////////////////////////
		// Create totals and different actions
		///////////////////////////////////////////////////////////////

		menu.addMenuItem(new TotalUsageMenuItem(makeTimeStrFromMins(total)));
		menu.addMenuItem(new StartTimeMenuItem(this.activityRecord.created.toString().substr(4,17)));

		// FIXME: This is temporary until UI is defined to
		//        enter project definitions
		let item = new PopupMenu.PopupMenuItem(_("Reload definitions"));
		item.connect('activate', Lang.bind(this, this._reloadProjects));
		menu.addMenuItem(item);

		let item = new PopupMenu.PopupMenuItem(_("Clear History"));
		item.connect('activate', Lang.bind(this, this._reset));
		menu.addMenuItem(item);
 
		this.activityRecord.saveToFile("/tmp/activityRecord");
	},

	_reset: function() {
		this.activityRecord = new ActivityRecord();
	},
 
	// Callback for when app focus changes
	_onFocusChanged: function() {
		if (DEBUG_METHOD_CALL) log("_onFocusChanged()");

		this.activityRecord.update();
	},

	_onSessionModeUpdated: function() {
		if (DEBUG_METHOD_CALL) log("_onSessionModeUpdated()");

		let inLockScreen = Main.sessionMode.isLocked;

		this.activityRecord.update();
		if (this.inLockScreen !== inLockScreen) {
			this.inLockScreen = inLockScreen;

			if (inLockScreen)
				this.activityRecord.pause();
			else
				this.activityRecord.resume();
		}

	},

	// Callback for when the menu is opened or closed
	_onMenuOpenStateChanged: function(menu, isOpen) {
		if (DEBUG_METHOD_CALL) log("_onMenuOpenStateChanged(" + menu + ", " + isOpen + ")");

		this.activityRecord.update();
		if (isOpen)
			this.refreshMenu();
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
