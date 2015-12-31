## Arya: Automatic Recorder of Your Activities

Arya is a simple Gnome 3 Shell extension that adds up how much time you spend
using each of your applications. It's not very fully featured yet, but in the
future it will hopefully be a useful extension.

This is a fork in which some changes were made and more are planned. Namely,
I'm in a search for some time now for a tool that would allow me to transparently
keep track my activities. By transparently I mean that I don't want to have
some additional task that I have to do in order to track time. In other words,
the system should do it for me.


But the first, and the most important change, is that I patched extension to
work with Gnome Shell 3.18.

Currently, this application tracks two different times:
* Time spent in each _type_ of application
* Time spent on particular Workspace

The reason for tracking time spent in workspaces is that I organized my
projects so that each one of them is on a separate workspace. Yet, I
don't think that is enough so expect changes in the future.

## Planned Features:
* Pretty graphs to show app usage over time
* Activity level monitoring to suggest when you should take a break
* Save/Load to/from a file
* Break time according to day, week, month...
* Introduce better mapping from applications/workspaces to projects, i.e. via regex
* Integrate with GTG and Hamster

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
