package main

import "testing"

func TestRedactArgsMasksCredentialedGitURLs(t *testing.T) {
	args := []string{"clone", "https://token:secret@github.com/org/repo.git", "/tmp/repo"}
	redacted := redactArgs(args)

	if redacted[1] != "https://****@github.com/org/repo.git" {
		t.Fatalf("credential URL not redacted: %q", redacted[1])
	}
	if args[1] == redacted[1] {
		t.Fatal("redaction should not leave credentialed URL intact")
	}
}

func TestCredentialedURLDetectionIsNarrow(t *testing.T) {
	if !isCredentialedURL("https://token@github.com/org/repo.git") {
		t.Fatal("expected https URL with userinfo to be detected")
	}
	for _, value := range []string{"https://github.com/org/repo.git", "git@github.com:org/repo.git", "ssh://git@github.com/org/repo.git"} {
		if isCredentialedURL(value) {
			t.Fatalf("did not expect %q to be treated as credentialed https URL", value)
		}
	}
}

func TestContainsFindsPushFlag(t *testing.T) {
	if !contains([]string{"build", "image", ".", "Dockerfile", "--push"}, "--push") {
		t.Fatal("expected --push to be found")
	}
	if contains([]string{"build", "image"}, "--push") {
		t.Fatal("did not expect missing --push to be found")
	}
}
