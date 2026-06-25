package bundle

import "testing"

func TestExtractSemver(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"2.1.191 (Claude Code)", "2.1.191"},
		{"codex-cli 0.142.2", "0.142.2"},
		{"Hermes Agent v0.17.0 (2026.6.19) · upstream d6269da7", "0.17.0"},
		{"no version here", ""},
	}
	for _, tc := range tests {
		if got := extractSemver(tc.in); got != tc.want {
			t.Errorf("extractSemver(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestSemverLess(t *testing.T) {
	if !semverLess("0.141.0", "0.142.2") {
		t.Error("0.141.0 should be less than 0.142.2")
	}
	if semverLess("2.1.191", "2.1.191") {
		t.Error("equal versions should not be less")
	}
	if semverLess("2.1.192", "2.1.191") {
		t.Error("2.1.192 should not be less than 2.1.191")
	}
}

func TestCheckUpgrade_codexUpToDate(t *testing.T) {
	installed := "codex-cli 0.142.2"
	latest, err := npmLatestVersion(clis["codex"].npmPkg)
	if err != nil {
		t.Skipf("npm unavailable: %v", err)
	}
	info := checkUpgrade("codex", installed)
	if !info.Checked {
		t.Fatal("expected checked")
	}
	if info.LatestVersion != latest {
		t.Errorf("latest = %q, npm says %q", info.LatestVersion, latest)
	}
	if semverLess(extractSemver(installed), latest) != info.UpdateAvailable {
		t.Errorf("UpdateAvailable=%v inconsistent with semver compare", info.UpdateAvailable)
	}
}
