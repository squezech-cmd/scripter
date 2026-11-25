//go:build windows

// BLACK desktop: a small WebView2 host with its web UI embedded in the executable.
package main

import (
	"embed"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"unsafe"

	webview "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

//go:embed index.html style.css app.js ai.js
var assets embed.FS

func message(text string) {
	title, _ := syscall.UTF16PtrFromString("BLACK")
	body, _ := syscall.UTF16PtrFromString(text)
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(body)), uintptr(unsafe.Pointer(title)), 0x10)
}

func main() {
	runtime.LockOSThread()
	// A fixed loopback origin preserves localStorage across launches.
	const address = "127.0.0.1:43671"
	listener, err := net.Listen("tcp", address)
	if err != nil {
		message("BLACK уже запущен или порт 43671 занят. Закройте другую копию и попробуйте снова.")
		return
	}
	defer listener.Close()
	sub, err := fs.Sub(assets, ".")
	if err != nil {
		message("Не удалось открыть файлы BLACK.")
		return
	}
	handler := http.FileServer(http.FS(sub))
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != address || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		handler.ServeHTTP(w, r)
	})}
	defer server.Close()
	go server.Serve(listener)

	base, err := os.UserConfigDir()
	if err != nil {
		message("Не удалось найти папку данных пользователя.")
		return
	}
	dataPath := filepath.Join(base, "BLACK", "WebView2")
	w := webview.NewWithOptions(webview.WebViewOptions{
		DataPath: dataPath, AutoFocus: true,
		WindowOptions: webview.WindowOptions{Title: "BLACK", Width: 1200, Height: 800, Center: true},
	})
	if w == nil {
		message("Не удалось открыть окно. Установите Microsoft Edge WebView2 Runtime и попробуйте снова.")
		return
	}
	defer w.Destroy()
	// Used only for the explicit “open externally” button.
	if err := w.Bind("blackOpenExternal", func(raw string) error {
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" {
			return fmt.Errorf("invalid URL")
		}
		target, err := windows.UTF16PtrFromString(u.String())
		if err != nil {
			return err
		}
		return windows.ShellExecute(0, nil, target, nil, nil, 1)
	}); err != nil {
		message("Не удалось подготовить окно BLACK.")
		return
	}
	w.Navigate(fmt.Sprintf("http://%s/", address))
	w.Run()
}
