# Lilac Study

Lilac Study is a static progressive web app for revision planning. It stores tasks, review history, notes, drawings, and focus time locally in the browser with IndexedDB, so GitHub Pages can host it without a server or login system.

## Run locally

Serve the folder with any static server:

```sh
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Deploy to GitHub Pages

Commit the files in this folder, push them to a GitHub repository, and enable Pages for the branch. The app uses relative paths, so it works from either a root domain or a repository subpath.
