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

const APPMENU_ICON_SIZE = 22;

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

function ActivityRecorder() {
  this._init();
}

ActivityRecorder.prototype = {
  __proto__: PanelMenu.Button.prototype,

  _init: function() {
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

    this._reset();
  },

	_reset: function() {

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

		this._updateState();
		this._refreshMenu();
	},

	// Update the current app and touch the swap time
	_updateState: function() {
		this._curr_app = this._getCurrentAppId();
		this._curr_workspace = global.screen.get_active_workspace().index();

		this._curr_project = null;
		let win = global.display.focus_window;
		if (win) {
			this._curr_project = win.title;
		}
	},

	// Recalculate the menu which shows time for each app
	_refreshMenu: function() {
		let menu = this.menu;
		menu.removeAll();

		let usage = this._usage;
		let ids = Object.keys(usage).sort(function(x,y) { return (usage[y] - usage[x]) });

		let app_system = Shell.AppSystem.get_default();

		let count = 0;
		let total = 0;
		ids.forEach(function(id) {
			if(usage[id] < 1) return;
			let app = app_system.lookup_app(id);
			if(app) {
				let mins = Math.round(usage[id]);
				let icon = app.create_icon_texture(APPMENU_ICON_SIZE);
				let str = makeTimeStrFromMins(mins);
				menu.addMenuItem(new AppUsageMenuItem(icon, app.get_name(), str));
				count += 1; total += mins;
			}
		});

		if (ids.length > 0) {
			menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
		}

		// Refresh workspace time
		for(let i = 0; i < global.screen.n_workspaces; i++) {
			let mins = Math.round(this._workspaceTime[i]);
			let str = makeTimeStrFromMins(mins);
			let workspaceName = Meta.prefs_get_workspace_name(i);
			menu.addMenuItem(new WorkspaceTimeMenuItem(workspaceName, str));
		};

		menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

		let projects = this._projects;
		let ids = Object.keys(projects);
		ids.forEach(function(id) {
			let mins = Math.round(projects[id]);
			let str = makeTimeStrFromMins(mins);
			menu.addMenuItem(new ProjectMenuItem(id, str));
		});

		if (ids.length > 0) {
			menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
		}
		menu.addMenuItem(new TotalUsageMenuItem(makeTimeStrFromMins(total)));

		let item = new PopupMenu.PopupMenuItem(_("Clear History"));
		item.connect('activate', Lang.bind(this, this._reset));
		this.menu.addMenuItem(item);
 
	},

	// Callback for when app focus changes
	_onFocusChanged: function() {
		this._recordTime();
		this._updateState();
		this._refreshMenu();
	},

	// Callback for when the menu is opened or closed
	_onMenuOpenStateChanged: function(menu, isOpen) {
		if(isOpen) { // Changed from closed to open
			this._updateState();
			this._refreshMenu();
		}
	},

  // Get the current app or null
  _getCurrentAppId: function() {
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
    // Add menu to panel
    Main.panel._rightBox.insert_child_at_index(this.actor, 0);
    Main.panel.menuManager.addMenu(this.menu);

    // Connect to the tracker
    let tracker = Shell.WindowTracker.get_default();
    this._tracker_id = tracker.connect("notify::focus-app", Lang.bind(this, this._onFocusChanged));

  },

  disable: function() {
    // Remove menu from panel
    Main.panel.menuManager.removeMenu(this.menu);
    Main.panel._rightBox.remove_actor(this.actor);

    // Remove tracker
    let tracker = Shell.WindowTracker.get_default();
    tracker.disconnect(this._tracker_id);
  }
}

function makeTimeStrFromMins(mins) {
  if(mins > 60) { // Report usage in hours
    return Math.round(mins*100/60)/100 + " hours";
  }
  if(mins == 1) {
    return mins + " minute";
  }
  else {
    return mins + " minutes"
  }
}


/**
 * From: http://blog.fpmurphy.com/2011/05/more-gnome-shell-customization.html
 */
function AppUsageMenuItem() {
  this._init.apply(this, arguments);
}

AppUsageMenuItem.prototype = {
  __proto__: PopupMenu.PopupBaseMenuItem.prototype,

  _init: function(icon, text1, text2, params) {
    PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

    this._topBox = new St.BoxLayout();

    this.label1 = new St.Label({ text: text1, width: 250 });
    this.label2 = new St.Label({ text: text2, width: 100 });
    this.icon = icon;

    this._topBox.add(this.icon);
    this._topBox.add(this.label1);
    this._topBox.add(this.label2);

    this.actor.add(this._topBox);
  }
};

function WorkspaceTimeMenuItem() {
  this._init.apply(this, arguments);
}

WorkspaceTimeMenuItem.prototype = {
  __proto__: PopupMenu.PopupBaseMenuItem.prototype,

  _init: function(text1, text2, params) {
    PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

    this._topBox = new St.BoxLayout();

    this.label1 = new St.Label({ text: text1, width: 300 });
    this.label2 = new St.Label({ text: text2, width: 100 });

    this._topBox.add(this.label1);
    this._topBox.add(this.label2);

    this.actor.add(this._topBox);
  }
};

function ProjectMenuItem() {
  this._init.apply(this, arguments);
}

ProjectMenuItem.prototype = {
  __proto__: PopupMenu.PopupBaseMenuItem.prototype,

  _init: function(text1, text2, params) {
    PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

    this._topBox = new St.BoxLayout();

    this.label1 = new St.Label({ text: text1, width: 300 });
    this.label2 = new St.Label({ text: text2, width: 100 });

    this._topBox.add(this.label1);
    this._topBox.add(this.label2);

    this.actor.add(this._topBox);
  }
};

function TotalUsageMenuItem() {
  this._init.apply(this, arguments);
}

TotalUsageMenuItem.prototype = {
  __proto__: PopupMenu.PopupBaseMenuItem.prototype,

  _init: function(time, params) {
    PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

    this._topBox = new St.BoxLayout();

    this.label1 = new St.Label({ text: "Total", width: 300 });
    this.label2 = new St.Label({ text: time,    width: 100 });

    this._topBox.add(this.label1);
    this._topBox.add(this.label2);

    this.actor.add(this._topBox);
  }
}
