from flask import Flask, redirect, render_template, request, url_for


def create_app() -> Flask:
    app = Flask(__name__)

    @app.route("/")
    def index():
        return redirect(url_for("login"))

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            return redirect(url_for("discover"))
        return render_template("auth/login.html")

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            return redirect(url_for("login"))
        return render_template("auth/register.html")

    @app.route("/discover", methods=["GET"])
    def discover():
        return render_template("main/discover.html")

    return app
