import { Component } from "@angular/core";
import { LevelOneComponent } from "./levels/level-one.component";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [LevelOneComponent],
  templateUrl: "./app.html",
  styleUrl: "./app.css",
})
export class App {}
