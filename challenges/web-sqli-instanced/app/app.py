"""Challenge volontairement vulnérable : injection SQL sur le login."""
import os
import sqlite3

from flask import Flask, request

app = Flask(__name__)
FLAG = os.environ.get("FLAG", "PAD{placeholder}")

PAGE = (
    "<h1>Portail</h1><form method=post><input name=user>"
    "<input name=password type=password><button>Login</button></form>"
)


def db():
    con = sqlite3.connect(":memory:")
    con.executescript(
        "CREATE TABLE users(name TEXT, password TEXT, secret TEXT);"
        "INSERT INTO users VALUES('guest','guest','rien ici');"
    )
    con.execute("INSERT INTO users VALUES('admin', hex(randomblob(16)), ?)", (FLAG,))
    return con


@app.route("/", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        return PAGE
    q = "SELECT name, secret FROM users WHERE name='%s' AND password='%s'" % (
        request.form.get("user", ""),
        request.form.get("password", ""),
    )
    try:
        row = db().execute(q).fetchone()
    except sqlite3.Error as e:
        return f"erreur SQL: {e}", 500
    return (f"Bienvenue {row[0]} : {row[1]}" if row else "Identifiants invalides") + PAGE


if __name__ == "__main__":
    app.run("0.0.0.0", 8080)
