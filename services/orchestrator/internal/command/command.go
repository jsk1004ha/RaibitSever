package command

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/raibitserver/orchestrator/internal/store"
)

type Command struct {
	Name     string
	Args     []string
	Dir      string
	Env      map[string]string
	Redacted string
}

type Result struct {
	Command  string
	DryRun   bool
	ExitCode int
	Stdout   string
	Stderr   string
}

type Runner interface {
	Run(ctx context.Context, cmd Command, dryRun bool, timeout time.Duration) (Result, error)
}

type OSRunner struct{}

func (OSRunner) Run(ctx context.Context, spec Command, dryRun bool, timeout time.Duration) (Result, error) {
	printable := CommandString(spec)
	if dryRun {
		return Result{Command: printable, DryRun: true, ExitCode: 0}, nil
	}
	if timeout <= 0 {
		timeout = 10 * time.Minute
	}
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, spec.Name, spec.Args...)
	cmd.Env = os.Environ()
	for key, value := range spec.Env {
		cmd.Env = append(cmd.Env, key+"="+value)
	}
	if spec.Dir != "" {
		cmd.Dir = spec.Dir
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	exitCode := 0
	if err != nil {
		exitCode = 1
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		}
	}
	result := Result{Command: printable, DryRun: false, ExitCode: exitCode, Stdout: store.Redact(stdout.String()), Stderr: store.Redact(stderr.String())}
	if err != nil {
		return result, fmt.Errorf("command failed (%d): %s\n%s", exitCode, printable, firstNonEmpty(result.Stderr, result.Stdout))
	}
	return result, nil
}

func CommandString(spec Command) string {
	if spec.Redacted != "" {
		return spec.Redacted
	}
	parts := append([]string{spec.Name}, spec.Args...)
	quoted := make([]string, len(parts))
	for i, part := range parts {
		quoted[i] = shellQuote(store.Redact(part))
	}
	return strings.Join(quoted, " ")
}

func shellQuote(value string) string {
	if value == "" {
		return "''"
	}
	if strings.IndexFunc(value, func(r rune) bool {
		return !(r >= 'a' && r <= 'z') && !(r >= 'A' && r <= 'Z') && !(r >= '0' && r <= '9') && !strings.ContainsRune("_@%+=:,./-", r)
	}) == -1 {
		return value
	}
	return "'" + strings.ReplaceAll(value, "'", `'"'"'`) + "'"
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
