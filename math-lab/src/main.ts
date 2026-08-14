import { Application } from './core/Application';
import { SidebarController } from './ui/SidebarController';

const app = new Application();
app.start();

const sidebar = new SidebarController();
sidebar.init();
