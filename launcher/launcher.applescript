-- Dashcam Editor launcher
-- Stay-open AppleScript applet: starts the local Express server on launch,
-- opens the browser, and stops the server when you Quit (Cmd-Q) the app.
-- Built into "Dashcam Editor.app" by build-app.sh.

property serverPID : ""
property ownsServer : false

on projectDir()
	return "/Users/austinjones/dashcam-editor"
end projectDir

on appURL()
	return "http://localhost:3847"
end appURL

on run
	startServer()
end run

on startServer()
	set nodeBin to "/usr/local/bin/node"
	set npmBin to "/usr/local/bin/npm"
	set theURL to appURL()

	-- If something is already serving on the port, just open the browser.
	if serverIsUp(theURL) then
		set ownsServer to false
		openBrowser(theURL)
		return
	end if

	-- First run: install dependencies if they're missing.
	try
		do shell script "test -d " & quoted form of (projectDir() & "/node_modules")
	on error
		do shell script quoted form of npmBin & " --prefix " & quoted form of projectDir() & " install"
	end try

	-- Start the server fully detached so this call returns immediately, and
	-- record its PID in a file. Redirecting all three fds + running in a
	-- subshell prevents `do shell script` from blocking on the stdout pipe.
	do shell script "cd " & quoted form of projectDir() & " && ( " & quoted form of nodeBin & " server.js >/tmp/dashcam-editor.log 2>&1 </dev/null & echo $! > /tmp/dashcam-editor.pid )"
	set serverPID to do shell script "cat /tmp/dashcam-editor.pid"
	set ownsServer to true

	-- Wait for the port to come up (up to ~12s).
	set isReady to false
	repeat 40 times
		if serverIsUp(theURL) then
			set isReady to true
			exit repeat
		end if
		delay 0.3
	end repeat

	if isReady then
		openBrowser(theURL)
	else
		display dialog "Dashcam Editor could not start. See /tmp/dashcam-editor.log for details." buttons {"OK"} default button "OK" with icon caution with title "Dashcam Editor"
		quit
	end if
end startServer

on serverIsUp(u)
	try
		do shell script "curl -s -o /dev/null --max-time 2 " & quoted form of u
		return true
	on error
		return false
	end try
end serverIsUp

on openBrowser(u)
	do shell script "open " & quoted form of u
end openBrowser

-- Clicking the Dock icon again re-opens the browser.
on reopen
	openBrowser(appURL())
end reopen

-- Keep the app alive; if the server we started has died, quit so the Dock reflects reality.
on idle
	if ownsServer and serverPID is not "" then
		try
			do shell script "kill -0 " & serverPID
		on error
			quit
		end try
	end if
	return 15
end idle

-- Quitting the app stops the server we started.
on quit
	if ownsServer and serverPID is not "" then
		try
			do shell script "kill " & serverPID
		end try
	end if
	continue quit
end quit
