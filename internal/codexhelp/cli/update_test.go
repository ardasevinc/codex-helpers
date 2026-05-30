package cli

import "testing"

func TestLatestTagFromLsRemoteFiltersCodexhelpTags(t *testing.T) {
	output := []byte(`abc	refs/tags/codex-auth-v0.3.6
def	refs/tags/codexhelp-v0.1.0
ghi	refs/tags/codexhelp-v0.2.0
jkl	refs/tags/not-a-version
`)
	tag, ok := latestTagFromLsRemote(output)
	if !ok {
		t.Fatal("expected tag")
	}
	if tag != "codexhelp-v0.2.0" {
		t.Fatalf("tag = %q, want codexhelp-v0.2.0", tag)
	}
}

func TestCompareVersionsAcceptsPrefixedTags(t *testing.T) {
	tests := []struct {
		current string
		latest  string
		want    versionStatus
	}{
		{current: "0.1.0", latest: "codexhelp-v0.1.1", want: versionOutdated},
		{current: "0.1.1", latest: "codexhelp-v0.1.1", want: versionCurrent},
		{current: "0.2.0", latest: "codexhelp-v0.1.1", want: versionAhead},
		{current: "0.1.0-dev", latest: "codexhelp-v0.1.1", want: versionUnknown},
	}
	for _, tt := range tests {
		if got := compareVersions(tt.current, tt.latest); got != tt.want {
			t.Fatalf("compareVersions(%q, %q) = %v, want %v", tt.current, tt.latest, got, tt.want)
		}
	}
}

func TestInstallCommandUsesReleaseInstaller(t *testing.T) {
	got := installCommand("codexhelp-v0.1.2", false)
	want := "curl -fsSL https://raw.githubusercontent.com/ardasevinc/codex-helpers/main/install.sh | sh -s -- codexhelp 0.1.2"
	if got != want {
		t.Fatalf("installCommand = %q, want %q", got, want)
	}
}

func TestInstallCommandWithoutVersionUsesLatestInstallerPath(t *testing.T) {
	got := installCommand("", false)
	want := "curl -fsSL https://raw.githubusercontent.com/ardasevinc/codex-helpers/main/install.sh | sh -s -- codexhelp"
	if got != want {
		t.Fatalf("installCommand = %q, want %q", got, want)
	}
}

func TestInstallCommandCanUseGoInstall(t *testing.T) {
	got := installCommand("codexhelp-v0.1.2", true)
	want := "go install github.com/ardasevinc/codex-helpers/cmd/codexhelp@codexhelp-v0.1.2"
	if got != want {
		t.Fatalf("installCommand = %q, want %q", got, want)
	}
}
