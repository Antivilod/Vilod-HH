// Command pack verifies a Vilod HH extension and optionally builds a Chrome ZIP.
package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const maxPayload = 32 << 20

var safeName = regexp.MustCompile(`^[A-Za-z0-9_./-]+$`)

type release struct {
	Format  string            `json:"format"`
	Schema  int               `json:"schema"`
	Version string            `json:"version"`
	Files   map[string]string `json:"files"`
}

type entry struct {
	name string
	data []byte
}

func readExtension(root string) ([]entry, string, error) {
	var files []entry
	byName := make(map[string][]byte)
	remaining := int64(maxPayload)
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(rel)
		if !d.Type().IsRegular() || !fs.ValidPath(name) || !safeName.MatchString(name) {
			return fmt.Errorf("unsupported extension entry %q", name)
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		data, err := io.ReadAll(io.LimitReader(f, remaining+1))
		if err != nil {
			return err
		}
		remaining -= int64(len(data))
		if remaining < 0 {
			return fmt.Errorf("extension exceeds %d bytes", maxPayload)
		}
		files = append(files, entry{name, data})
		byName[name] = data
		return nil
	})
	if err != nil {
		return nil, "", err
	}
	var inventory release
	if err := json.Unmarshal(byName["release-ready.json"], &inventory); err != nil {
		return nil, "", fmt.Errorf("invalid release-ready.json: %w", err)
	}
	var manifest struct {
		Name            string `json:"name"`
		Version         string `json:"version"`
		ManifestVersion int    `json:"manifest_version"`
	}
	if err := json.Unmarshal(byName["manifest.json"], &manifest); err != nil {
		return nil, "", fmt.Errorf("invalid manifest.json: %w", err)
	}
	if inventory.Format != "vilod-hh-release" || inventory.Schema != 1 ||
		inventory.Version == "" || inventory.Version != manifest.Version ||
		manifest.Name != "Vilod HH" || manifest.ManifestVersion != 3 {
		return nil, "", fmt.Errorf("unexpected release metadata")
	}
	if len(files) != len(inventory.Files)+1 {
		return nil, "", fmt.Errorf("extension file count differs from inventory")
	}
	for _, f := range files {
		if f.name == "release-ready.json" {
			continue
		}
		if fmt.Sprintf("%x", sha256.Sum256(f.data)) != inventory.Files[f.name] {
			return nil, "", fmt.Errorf("missing or mismatched checksum for %q", f.name)
		}
	}
	return files, manifest.Version, nil
}

func pack(path string, files []entry) (err error) {
	out, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := out.Close(); err == nil {
			err = closeErr
		}
		if err != nil {
			_ = os.Remove(path)
		}
	}()
	archive := zip.NewWriter(out)
	for _, file := range files {
		entry, err := archive.Create("extension/" + file.name)
		if err != nil {
			return err
		}
		if _, err := entry.Write(file.data); err != nil {
			return err
		}
	}
	return archive.Close()
}

func run() error {
	root := flag.String("extension", "../../extension", "path to the Vilod HH extension directory")
	out := flag.String("out", "", "new ZIP path (omit to verify only)")
	flag.Parse()
	if flag.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments")
	}
	if *out != "" && !strings.EqualFold(filepath.Ext(*out), ".zip") {
		return fmt.Errorf("output must have a .zip extension")
	}
	files, version, err := readExtension(*root)
	if err != nil {
		return err
	}
	if *out != "" {
		if err := pack(*out, files); err != nil {
			return err
		}
	}
	fmt.Printf("Vilod HH %s: verified %d files\n", version, len(files))
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
