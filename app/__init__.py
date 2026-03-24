from flask import Flask, render_template


def create_app() -> Flask:
    app = Flask(__name__)

    @app.get("/")
    @app.get("/login")
    def login():
        return render_template("auth/login.html")

    return app
