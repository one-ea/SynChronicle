package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestCLIStartupCreatesSynchronicleConfigDirectory(t *testing.T) {
	home := t.TempDir()
	command := exec.Command(os.Args[0], "-test.run=TestCLIHelper")
	command.Env = append(os.Environ(), "SYNCHRONICLE_CLI_HELPER=1", "HOME="+home)
	if err := command.Run(); err == nil {
		t.Fatal("expected configuration validation failure")
	}
	configDir := filepath.Join(home, ".synchronicle")
	if info, err := os.Stat(configDir); err != nil || !info.IsDir() {
		t.Fatalf("CLI did not create %q: %v", configDir, err)
	}
}

func TestCLIHelper(t *testing.T) {
	if os.Getenv("SYNCHRONICLE_CLI_HELPER") == "" {
		return
	}
	os.Args = []string{"synchronicle", "--headless"}
	main()
}
