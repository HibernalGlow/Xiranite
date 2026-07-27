package main

import "testing"

func TestNewExternalNodeLaunchProtocolRegistrationQuotesExecutable(t *testing.T) {
	registration, err := newExternalNodeLaunchProtocolRegistration(`C:\Program Files\Xiranite\Xiranite.exe`)
	if err != nil {
		t.Fatal(err)
	}
	if registration.Description != externalNodeLaunchProtocolDescription {
		t.Fatalf("description = %q", registration.Description)
	}
	if registration.Command != `"C:\Program Files\Xiranite\Xiranite.exe" "%1"` {
		t.Fatalf("command = %q", registration.Command)
	}
}

func TestQuoteExternalNodeLaunchWindowsArgumentEscapesTrailingSlashAndQuote(t *testing.T) {
	quoted, err := quoteExternalNodeLaunchWindowsArgument(`C:\Tools\A"B\`)
	if err != nil {
		t.Fatal(err)
	}
	if quoted != `"C:\Tools\A\"B\\"` {
		t.Fatalf("quoted argument = %q", quoted)
	}
}

func TestQuoteExternalNodeLaunchWindowsArgumentRejectsControlCharacters(t *testing.T) {
	if _, err := quoteExternalNodeLaunchWindowsArgument("C:\\Xiranite.exe\nsecond-command"); err == nil {
		t.Fatal("expected command control character to be rejected")
	}
}
