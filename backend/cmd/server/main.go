package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"scripta/backend/internal/api"
	"scripta/backend/internal/hub"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	addr := os.Getenv("ADDR")
	if addr == "" {
		if port := os.Getenv("PORT"); port != "" {
			addr = ":" + port
		} else {
			addr = ":8080"
		}
	}

	h := hub.New(log)
	apiHandler := api.NewServer(h, log)
	handler := withStaticApps(apiHandler, os.Getenv("STATIC_DIR"), log)

	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Info("Scripta backend listening", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	log.Info("shutting down gracefully")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}

func withStaticApps(apiHandler http.Handler, staticDir string, log *slog.Logger) http.Handler {
	if staticDir == "" {
		if _, err := os.Stat("dist"); err == nil {
			staticDir = "dist"
		}
	}
	if staticDir == "" {
		return apiHandler
	}

	desktopDir := filepath.Join(staticDir, "desktop")
	mobileDir := filepath.Join(staticDir, "mobile")
	if _, err := os.Stat(desktopDir); err != nil {
		return apiHandler
	}

	log.Info("serving static web apps", "desktop", desktopDir, "mobile", mobileDir)
	desktopSPA := spaHandler(desktopDir)
	mobileSPA := http.StripPrefix("/m/", spaHandler(mobileDir))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if strings.HasPrefix(p, "/api/") || p == "/ws" {
			apiHandler.ServeHTTP(w, r)
			return
		}
		if p == "/m" {
			http.Redirect(w, r, "/m/", http.StatusMovedPermanently)
			return
		}
		if strings.HasPrefix(p, "/m/") {
			mobileSPA.ServeHTTP(w, r)
			return
		}
		desktopSPA.ServeHTTP(w, r)
	})
}

func spaHandler(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	indexPath := filepath.Join(dir, "index.html")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/"))
		if clean != "" && clean != "." {
			if info, err := os.Stat(filepath.Join(dir, clean)); err == nil && !info.IsDir() {
				fs.ServeHTTP(w, r)
				return
			}
		}
		http.ServeFile(w, r, indexPath)
	})
}
