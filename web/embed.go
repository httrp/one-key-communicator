package web

import "embed"

//go:embed landing/*
var LandingFS embed.FS

//go:embed app/*
var AppFS embed.FS
