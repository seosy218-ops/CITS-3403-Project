from flask import Flask, render_template


def create_app() -> Flask:
    app = Flask(__name__)

    @app.route("/", methods=["GET"])
    @app.route("/login", methods=["GET", "POST"])
    def login():
        return render_template("auth/login.html")

    @app.route("/register", methods=["GET", "POST"])
    def register():
        return render_template("auth/register.html")

    return app
