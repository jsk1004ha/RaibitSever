package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

func main() {
	if len(os.Args) < 2 || os.Args[1] == "help" {
		fmt.Println("raibitserver-builder: clone <repo> <dest> [branch] | build <image> <context> <dockerfile> [--push] | push <image>")
		return
	}
	dryRun := os.Getenv("RAIBITSERVER_EXECUTE") != "1"
	var err error
	switch os.Args[1] {
	case "clone":
		if len(os.Args) < 4 {
			err = fmt.Errorf("clone requires <repo> <dest> [branch]")
			break
		}
		if isCredentialedURL(os.Args[2]) {
			err = fmt.Errorf("credentialed git URLs are not allowed; use a secret-backed token/askpass in the worker environment")
			break
		}
		branch := "main"
		if len(os.Args) > 4 {
			branch = os.Args[4]
		}
		err = run(dryRun, "git", "clone", "--depth", "1", "--branch", branch, os.Args[2], os.Args[3])
	case "build":
		if len(os.Args) < 5 {
			err = fmt.Errorf("build requires <image> <context> <dockerfile> [--push]")
			break
		}
		push := contains(os.Args, "--push")
		args := []string{"buildx", "build", "--file", os.Args[4], "--tag", os.Args[2]}
		if push {
			args = append(args, "--push")
		} else {
			args = append(args, "--load")
		}
		args = append(args, os.Args[3])
		err = run(dryRun, "docker", args...)
	case "push":
		if len(os.Args) < 3 {
			err = fmt.Errorf("push requires <image>")
			break
		}
		err = run(dryRun, "docker", "push", os.Args[2])
	default:
		err = fmt.Errorf("unknown command: %s", os.Args[1])
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(dryRun bool, name string, args ...string) error {
	fmt.Println("$", name, strings.Join(redactArgs(args), " "))
	if dryRun {
		return nil
	}
	cmd := exec.Command(name, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin
	return cmd.Run()
}

func contains(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

func redactArgs(args []string) []string {
	redacted := make([]string, len(args))
	for i, arg := range args {
		if isCredentialedURL(arg) {
			redacted[i] = "https://****@" + strings.SplitN(arg, "@", 2)[1]
		} else {
			redacted[i] = arg
		}
	}
	return redacted
}

func isCredentialedURL(value string) bool {
	return strings.HasPrefix(value, "https://") && strings.Contains(strings.TrimPrefix(value, "https://"), "@")
}
