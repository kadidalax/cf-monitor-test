package main

import (
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

var logFilePath string
var verboseLogs bool

const agentLogMaxBytes = int64(5 << 20)
const agentLogBackups = 3
const agentLogMaxAge = 7 * 24 * time.Hour

type rotatingAgentLog struct {
	mu       sync.Mutex
	path     string
	maxBytes int64
	backups  int
	maxAge   time.Duration
	now      func() time.Time
	file     *os.File
	size     int64
	day      string
}

func newRotatingAgentLog(path string, maxBytes int64, backups int, maxAge time.Duration, now func() time.Time) (*rotatingAgentLog, error) {
	if maxBytes < 1 || backups < 0 || maxAge <= 0 {
		return nil, errors.New("invalid log retention settings")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	writer := &rotatingAgentLog{path: path, maxBytes: maxBytes, backups: backups, maxAge: maxAge, now: now}
	if err := writer.prune(); err != nil {
		return nil, err
	}
	if err := writer.open(); err != nil {
		return nil, err
	}
	if writer.size > writer.maxBytes || (writer.size > 0 && writer.day != writer.now().UTC().Format("2006-01-02")) {
		if err := writer.rotate(); err != nil {
			writer.Close()
			return nil, err
		}
	}
	return writer, nil
}

func validateLogFile(path string) error {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("Agent log must be a regular file")
	}
	return nil
}

func (w *rotatingAgentLog) open() error {
	if err := validateLogFile(w.path); err != nil {
		return err
	}
	file, err := os.OpenFile(w.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return err
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return err
	}
	w.file, w.size, w.day = file, info.Size(), info.ModTime().UTC().Format("2006-01-02")
	if w.size == 0 {
		w.day = w.now().UTC().Format("2006-01-02")
	}
	return nil
}

func (w *rotatingAgentLog) prune() error {
	cutoff := w.now().Add(-w.maxAge)
	for index := 1; index <= w.backups; index++ {
		path := w.path + "." + strconv.Itoa(index)
		if err := validateLogFile(path); err != nil {
			return err
		}
		info, err := os.Stat(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if info.ModTime().Before(cutoff) || info.Size() > w.maxBytes {
			if err := os.Remove(path); err != nil {
				return err
			}
		}
	}
	return nil
}

func (w *rotatingAgentLog) rotate() error {
	if w.file != nil {
		if err := w.file.Close(); err != nil {
			return err
		}
		w.file = nil
	}
	for index := w.backups; index >= 1; index-- {
		destination := w.path + "." + strconv.Itoa(index)
		if err := validateLogFile(destination); err != nil {
			return err
		}
		if index == w.backups {
			if err := os.Remove(destination); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
		source := w.path
		if index > 1 {
			source += "." + strconv.Itoa(index-1)
		}
		if err := validateLogFile(source); err != nil {
			return err
		}
		if err := os.Rename(source, destination); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	if w.backups == 0 {
		if err := os.Remove(w.path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	if err := w.prune(); err != nil {
		return err
	}
	return w.open()
}

func (w *rotatingAgentLog) Write(data []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	originalLength := len(data)
	if int64(len(data)) > w.maxBytes {
		data = data[:int(w.maxBytes)]
	}
	day := w.now().UTC().Format("2006-01-02")
	if w.size > 0 && (w.size+int64(len(data)) > w.maxBytes || w.day != day) {
		if err := w.rotate(); err != nil {
			return 0, err
		}
	}
	if w.file == nil {
		return 0, os.ErrClosed
	}
	n, err := w.file.Write(data)
	w.size += int64(n)
	w.day = day
	if err != nil {
		return n, err
	}
	return originalLength, nil
}

func (w *rotatingAgentLog) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file == nil {
		return nil
	}
	err := w.file.Close()
	w.file = nil
	return err
}

func initializeAgentLogging() (io.Closer, error) {
	if logFilePath == "" {
		return nil, nil
	}
	writer, err := newRotatingAgentLog(logFilePath, agentLogMaxBytes, agentLogBackups, agentLogMaxAge, time.Now)
	if err != nil {
		return nil, err
	}
	log.SetOutput(writer)
	return writer, nil
}

func verboseLogf(format string, values ...any) {
	if verboseLogs {
		log.Print(fmt.Sprintf(format, values...))
	}
}
