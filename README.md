## Arya: Automatic Recorder of Your Activities

Arya is a simple Gnome 3 Shell extension that adds up how much time you spend
using each of your applications. It's not very fully featured yet, but in the
future it will hopefully be a useful extension.

This is a fork in which some changes were made and more are planned. Namely,
I'm in a search for some time now for a tool that would allow me to transparently
keep track of my activities. By transparently I mean that I don't want to have
some additional task that I have to do in order to track time. In other words,
the system should do it for me without me being aware of it doing it.

But the first, and the most important change, is that I patched extension to
work with Gnome Shell 3.18 so I can use it on Fedora 23.

Currently, this application tracks three different times:
* Time spent in each _type_ of application.
* Time spent on particular Workspace.
* Time spent in some _project_.

The reason for tracking time spent in workspaces is that I organized my
projects so that each one of them is on a separate workspace.

To track how much time I spent in a certain project, I defined a set of
regular expressions that are run against the current window title. Each
regular expression has assigned a project name, so when some RE matches
window title then the extension assumes I'm working on a project assigned
to the matched RE and so it keeps time for that particular project.

For the time being, regular expressions are embedded within the code of
extension but I'll move them into a separate file eventually. When I do
that then I'll add UI for a user to be able to defined his/her own REs.

## Planned Features:
* Pretty graphs to show app usage over time
* Activity level monitoring to suggest when you should take a break
* Break time according to day, week, month...
* Introduce better mapping from applications/workspaces to projects, i.e. via regex
* Integrate with GTG and Hamster
* Make it configurable so that the user can define what to track
* When extension doesn't know what we are doing it should ask a user with an option to continue with the current activity
* If the time spent in certain project/window/app doesn't pass threshold don't count it
* Files with state must have meta information stored with them
* Add indicator of current workspace/project/window/application

## Install Instructions:

0. git clone git://github.com/sgros/Arya.git ~/.local/share/gnome-shell/extensions/arya@sgros.github.com
1. Restart gnome-shell: ALT+F2, then enter "r" without quotes or log out and back in

## Licensing

Arya: Automatic Recorder of Your Activity.
Copyright (C) 2012 Jon Crussell
Copyright (C) 2015 Stjepan Groš

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with this program.  If not, see <http://www.gnu.org/licenses/>.

## Some screenshots:

![Alt text](images/popup_menu.png?raw=true "Main popup")

![Alt text](images/popup_menu_apps.png?raw=true "Apps expanded")

![Alt text](images/popup_menu_workspaces.png?raw=true "Workspaces expanded")

