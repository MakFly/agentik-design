package identity

import (
	"os"
	"testing"
)

// LoadOrCreate must mint a stable id and return the same value on every call —
// the whole point of the daemon.id file (no new identity on restart).
func TestLoadOrCreateIsStable(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	id1, err := LoadOrCreate()
	if err != nil {
		t.Fatalf("first LoadOrCreate: %v", err)
	}
	if id1 == "" {
		t.Fatal("LoadOrCreate returned an empty id")
	}
	id2, err := LoadOrCreate()
	if err != nil {
		t.Fatalf("second LoadOrCreate: %v", err)
	}
	if id1 != id2 {
		t.Fatalf("identity not stable across calls: %q != %q", id1, id2)
	}
	if _, err := os.Stat(IDPath()); err != nil {
		t.Fatalf("expected id file at %s: %v", IDPath(), err)
	}
}

func TestLegacyDaemonIDs(t *testing.T) {
	ids := LegacyDaemonIDs()

	// When the OS reports a hostname, it must appear (the pre-UUID identity the
	// engine reconciles against).
	if h, err := os.Hostname(); err == nil && h != "" {
		found := false
		for _, id := range ids {
			if id == h {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("legacy ids %v do not include hostname %q", ids, h)
		}
	}

	// No empties, no duplicates.
	seen := map[string]bool{}
	for _, id := range ids {
		if id == "" {
			t.Fatalf("legacy ids contain an empty string: %v", ids)
		}
		if seen[id] {
			t.Fatalf("legacy ids contain a duplicate %q: %v", id, ids)
		}
		seen[id] = true
	}
}

// legacyFormsOf must derive the bare form from an mDNS ".local" hostname, dedupe,
// and drop empties — so a host that gains/loses the suffix still reconciles.
func TestLegacyFormsOf(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"my-box.local", []string{"my-box.local", "my-box"}},
		{"my-box", []string{"my-box"}},
		{"", []string{}},
		{"  ", []string{}},
	}
	for _, tc := range cases {
		got := legacyFormsOf(tc.in)
		if len(got) != len(tc.want) {
			t.Fatalf("legacyFormsOf(%q) = %v, want %v", tc.in, got, tc.want)
		}
		for i := range tc.want {
			if got[i] != tc.want[i] {
				t.Fatalf("legacyFormsOf(%q) = %v, want %v", tc.in, got, tc.want)
			}
		}
	}
}
