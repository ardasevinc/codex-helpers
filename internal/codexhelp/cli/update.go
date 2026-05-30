package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/ardasevinc/codex-helpers/internal/codexhelp/buildinfo"
)

const (
	repoSlug   = "ardasevinc/codex-helpers"
	updatePkg  = "codexhelp"
	installURL = "https://raw.githubusercontent.com/" + repoSlug + "/main/install.sh"
	gitRemote  = "https://github.com/" + repoSlug + ".git"
	modulePath = "github.com/ardasevinc/codex-helpers/cmd/codexhelp"
)

type versionStatus int

const (
	versionUnknown versionStatus = iota
	versionCurrent
	versionOutdated
	versionAhead
)

type updateCheck struct {
	Current string
	Latest  string
	Status  versionStatus
}

var errNoRelease = errors.New("no codexhelp releases found")

func newUpdateCommand(state *appState) *cobra.Command {
	var checkOnly bool
	var printOnly bool
	var viaGoInstall bool
	cmd := &cobra.Command{
		Use:   "update",
		Short: "Check or run the codexhelp update path",
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) > 0 {
				return fmt.Errorf("update does not accept positional arguments")
			}
			check, err := checkLatest(cmd.Context(), buildinfo.Version)
			if err != nil {
				return err
			}
			printUpdateCheck(state.out, check)
			command := installCommand(check.Latest, viaGoInstall)
			if printOnly || checkOnly || check.Status == versionCurrent || check.Status == versionAhead {
				if printOnly {
					_, _ = fmt.Fprintln(state.out, command)
				}
				return nil
			}
			_, _ = fmt.Fprintf(state.out, "running: %s\n", command)
			return runInstall(cmd.Context(), check.Latest, viaGoInstall)
		},
	}
	cmd.Flags().BoolVar(&checkOnly, "check", false, "check for updates without installing")
	cmd.Flags().BoolVar(&printOnly, "print", false, "print the update command without running it")
	cmd.Flags().BoolVar(&viaGoInstall, "go-install", false, "use go install instead of the release installer")
	return cmd
}

func newInstallCommand(state *appState) *cobra.Command {
	var printOnly bool
	var viaGoInstall bool
	cmd := &cobra.Command{
		Use:   "install [version]",
		Short: "Print or run the codexhelp install path",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			version := ""
			if len(args) == 1 {
				version = args[0]
			}
			command := installCommand(version, viaGoInstall)
			if printOnly {
				_, _ = fmt.Fprintln(state.out, command)
				return nil
			}
			_, _ = fmt.Fprintf(state.out, "running: %s\n", command)
			return runInstall(cmd.Context(), version, viaGoInstall)
		},
	}
	cmd.Flags().BoolVar(&printOnly, "print", false, "print the install command without running it")
	cmd.Flags().BoolVar(&viaGoInstall, "go-install", false, "use go install instead of the release installer")
	return cmd
}

func checkLatest(ctx context.Context, current string) (updateCheck, error) {
	latest, err := latestTag(ctx)
	if err != nil {
		if errors.Is(err, errNoRelease) {
			return updateCheck{Current: current, Status: versionUnknown}, nil
		}
		return updateCheck{}, err
	}
	return updateCheck{Current: current, Latest: latest, Status: compareVersions(current, latest)}, nil
}

func latestTag(ctx context.Context) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", "ls-remote", "--tags", "--refs", gitRemote)
	output, err := cmd.Output()
	if err == nil {
		if tag, ok := latestTagFromLsRemote(output); ok {
			return tag, nil
		}
	}
	return latestTagFromGitHub(ctx)
}

func latestTagFromGitHub(ctx context.Context) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/repos/"+repoSlug+"/releases", nil)
	if err != nil {
		return "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("github releases returned %s", resp.Status)
	}
	var releases []struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return "", err
	}
	var tags []string
	for _, release := range releases {
		if _, ok := parseVersion(strings.TrimPrefix(release.TagName, updatePkg+"-")); ok {
			tags = append(tags, release.TagName)
		}
	}
	if len(tags) == 0 {
		return "", errNoRelease
	}
	sort.Slice(tags, func(i, j int) bool {
		return compareVersions(tags[i], tags[j]) == versionAhead
	})
	return tags[0], nil
}

func latestTagFromLsRemote(output []byte) (string, bool) {
	var tags []string
	for _, line := range bytes.Split(output, []byte{'\n'}) {
		fields := bytes.Fields(line)
		if len(fields) != 2 {
			continue
		}
		tag := strings.TrimPrefix(string(fields[1]), "refs/tags/")
		if _, ok := parseVersion(strings.TrimPrefix(tag, updatePkg+"-")); ok {
			tags = append(tags, tag)
		}
	}
	if len(tags) == 0 {
		return "", false
	}
	sort.Slice(tags, func(i, j int) bool {
		return compareVersions(tags[i], tags[j]) == versionAhead
	})
	return tags[0], true
}

func compareVersions(current, latest string) versionStatus {
	cur, curOK := parseVersion(strings.TrimPrefix(current, updatePkg+"-"))
	next, nextOK := parseVersion(strings.TrimPrefix(latest, updatePkg+"-"))
	if !curOK || !nextOK {
		return versionUnknown
	}
	for i := range cur {
		switch {
		case cur[i] < next[i]:
			return versionOutdated
		case cur[i] > next[i]:
			return versionAhead
		}
	}
	return versionCurrent
}

func parseVersion(value string) ([3]int, bool) {
	value = strings.TrimSpace(strings.TrimPrefix(value, "v"))
	parts := strings.Split(value, ".")
	if len(parts) != 3 {
		return [3]int{}, false
	}
	var version [3]int
	for i, part := range parts {
		if part == "" || strings.ContainsFunc(part, func(r rune) bool { return r < '0' || r > '9' }) {
			return [3]int{}, false
		}
		n, err := strconv.Atoi(part)
		if err != nil {
			return [3]int{}, false
		}
		version[i] = n
	}
	return version, true
}

func statusText(status versionStatus) string {
	switch status {
	case versionCurrent:
		return "up to date"
	case versionOutdated:
		return "update available"
	case versionAhead:
		return "ahead of latest release"
	default:
		return "no release found"
	}
}

func printUpdateCheck(out interface{ Write([]byte) (int, error) }, check updateCheck) {
	latest := check.Latest
	if strings.TrimSpace(latest) == "" {
		latest = "(none)"
	}
	_, _ = fmt.Fprintf(out, "current: %s\n", check.Current)
	_, _ = fmt.Fprintf(out, "latest:  %s\n", latest)
	_, _ = fmt.Fprintf(out, "status:  %s\n", statusText(check.Status))
}

func installCommand(version string, viaGoInstall bool) string {
	if viaGoInstall {
		if strings.TrimSpace(version) == "" {
			version = "latest"
		}
		return "go install " + modulePath + "@" + version
	}
	version = strings.TrimPrefix(version, updatePkg+"-v")
	command := "curl -fsSL " + installURL + " | sh -s -- " + updatePkg
	if strings.TrimSpace(version) != "" {
		command += " " + version
	}
	return command
}

func runInstall(ctx context.Context, version string, viaGoInstall bool) error {
	if viaGoInstall {
		tag := strings.TrimSpace(version)
		if tag == "" {
			tag = "latest"
		} else if _, ok := parseVersion(strings.TrimPrefix(tag, updatePkg+"-")); !ok {
			return fmt.Errorf("invalid release tag %q", version)
		}
		// #nosec G204 -- tag is either "latest" or a validated semver release tag.
		cmd := exec.CommandContext(ctx, "go", "install", modulePath+"@"+tag)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		return cmd.Run()
	}
	version = strings.TrimPrefix(version, updatePkg+"-v")
	if version != "" {
		if _, ok := parseVersion(version); !ok {
			return fmt.Errorf("invalid release version %q", version)
		}
	}
	curl := exec.CommandContext(ctx, "curl", "-fsSL", installURL)
	// #nosec G204 -- fixed shell path and validated installer arguments; script content is the explicit update contract.
	sh := exec.CommandContext(ctx, "sh", append([]string{"-s", "--", updatePkg}, optionalArg(version)...)...)
	reader, writer := io.Pipe()
	curl.Stdout = writer
	curl.Stderr = os.Stderr
	sh.Stdin = reader
	sh.Stdout = os.Stdout
	sh.Stderr = os.Stderr
	if err := curl.Start(); err != nil {
		_ = writer.Close()
		_ = reader.Close()
		return err
	}
	if err := sh.Start(); err != nil {
		_ = writer.Close()
		_ = reader.Close()
		_ = curl.Wait()
		return err
	}
	curlErr := curl.Wait()
	_ = writer.Close()
	shErr := sh.Wait()
	_ = reader.Close()
	if curlErr != nil {
		return curlErr
	}
	return shErr
}

func optionalArg(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return []string{value}
}
