package bundle

import (
	"context"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"
)

// UpgradeInfo describes whether a newer release exists for an installed CLI.
type UpgradeInfo struct {
	LatestVersion   string `json:"latestVersion,omitempty"`
	UpdateAvailable bool   `json:"updateAvailable"`
	Checked         bool   `json:"checked"`
}

var (
	upgradeCache   sync.Map // kind -> cachedUpgrade
	upgradeCacheTTL = 30 * time.Minute
	semverRe       = regexp.MustCompile(`(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)`)
)

type cachedUpgrade struct {
	at   time.Time
	info UpgradeInfo
}

// UpgradeInfoFor reports whether kind has a newer release than installedVersion.
// Results are cached per kind to avoid hammering npm/registry on every probe.
func UpgradeInfoFor(kind, installedVersion string) UpgradeInfo {
	if installedVersion == "" {
		return UpgradeInfo{}
	}
	if v, ok := upgradeCache.Load(kind); ok {
		c := v.(cachedUpgrade)
		if time.Since(c.at) < upgradeCacheTTL {
			return c.info
		}
	}
	info := checkUpgrade(kind, installedVersion)
	upgradeCache.Store(kind, cachedUpgrade{at: time.Now(), info: info})
	return info
}

// InvalidateUpgradeCache drops cached upgrade info for kind (after install/upgrade).
func InvalidateUpgradeCache(kind string) {
	upgradeCache.Delete(kind)
}

func checkUpgrade(kind, installedVersion string) UpgradeInfo {
	installed := extractSemver(installedVersion)
	if installed == "" {
		return UpgradeInfo{}
	}

	switch kind {
	case "hermes":
		return hermesUpgradeInfo(installed)
	case "claude", "codex", "gemini":
		sp, ok := clis[kind]
		if !ok || sp.npmPkg == "" {
			return UpgradeInfo{}
		}
		latest, err := npmLatestVersion(sp.npmPkg)
		if err != nil || latest == "" {
			return UpgradeInfo{}
		}
		return UpgradeInfo{
			LatestVersion:   latest,
			UpdateAvailable: semverLess(installed, latest),
			Checked:         true,
		}
	default:
		return UpgradeInfo{}
	}
}

func hermesUpgradeInfo(installed string) UpgradeInfo {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "hermes", "update", "--check").CombinedOutput()
	text := strings.ToLower(string(out))
	if err != nil {
		return UpgradeInfo{}
	}
	if strings.Contains(text, "already up to date") {
		return UpgradeInfo{
			LatestVersion:   installed,
			UpdateAvailable: false,
			Checked:         true,
		}
	}
	// Update available — hermes doesn't print the target version reliably.
	return UpgradeInfo{
		UpdateAvailable: true,
		Checked:         true,
	}
}

func npmLatestVersion(pkg string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "npm", "view", pkg, "version", "--json").Output()
	if err != nil {
		return "", err
	}
	v := strings.TrimSpace(string(out))
	v = strings.Trim(v, `"`)
	return v, nil
}

func extractSemver(s string) string {
	if m := semverRe.FindStringSubmatch(s); len(m) > 1 {
		// Strip prerelease suffix for comparison when it's metadata noise.
		core := m[1]
		if i := strings.IndexAny(core, "-+"); i > 0 {
			return core[:i]
		}
		return core
	}
	return ""
}

// semverLess returns true when a < b (both normalized x.y.z).
func semverLess(a, b string) bool {
	if a == b {
		return false
	}
	ap := parseParts(a)
	bp := parseParts(b)
	for i := 0; i < 3; i++ {
		if ap[i] < bp[i] {
			return true
		}
		if ap[i] > bp[i] {
			return false
		}
	}
	return false
}

func parseParts(v string) [3]int {
	var p [3]int
	for i, part := range strings.SplitN(v, ".", 3) {
		if i > 2 {
			break
		}
		n := 0
		for _, c := range part {
			if c < '0' || c > '9' {
				break
			}
			n = n*10 + int(c-'0')
		}
		p[i] = n
	}
	return p
}
