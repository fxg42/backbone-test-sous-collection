//
// Pour faire les tests, nous remplaçons la méthode appelée lors d'un `fetch`.
// Au-lieu de monter au serveur, on retourne un Object en mémoire.
//
Backbone.sync = function (method, model, options) {
  var db = {
    '1': {
      dev: 'Alice',
      favoriteLanguages: [ {name:'javascript'}, {name:'ruby'}, {name:'python'} ]
    },
    '2': {
      dev: 'Bob',
      favoriteLanguages: [ {name:'lisp'}, {name:'haskell'}, {name:'clojure'} ]
    },
    '3': {
      dev: 'Carol',
      favoriteLanguages: [ {name:'smalltalk'}, {name:'ruby'}, {name:'coffeescript'} ]
    }
  };
  var resp = db[model.id];
  options.success(model, resp, options);
  model.trigger('sync', model, resp, options);
};

//
// Un langage a un nom. Les langages préférés d'un développeur est une
// collection de langages.
//
var Language = Backbone.Model.extend({
  defaults: { name: '' }
});

var FavoriteLanguages = Backbone.Collection.extend({
  model: Language
});

//
// Un développeur a un nom et une liste de langages préférés.
//
var Developer = Backbone.Model.extend({
  defaults: {
    dev: '',
    favoriteLanguages: new FavoriteLanguages()
  },

  // La méthode `parse` est appelée, entre autres choses, lorsqu'un document
  // JSON est retournée par la méthode `Backbone.sync`. Ici, on transforme les
  // réponses brutes JSON en collections Backbone. Il s'agit du `backbonify`...
  // De plus, on propage les événements des sous-collections vers this.
  parse: function (resp, options) {
    this.off('all', this.trigger, this);
    resp.favoriteLanguages = new FavoriteLanguages(resp.favoriteLanguages).on('all', this.trigger, this);
    return resp;
  },

  // On doit faire l'opération inverse du `parse` lorsqu'on redemande la
  // représentation JSON du modèle.
  toJSON: function () {
    var json = _.clone(this.attributes);
    json.favoriteLanguages = json.favoriteLanguages.toJSON();
    return json;
  }
});

//
// Cette vue est attachée à un élément statique du DOM. C'est une vue en lecture
// seule qui n'est mise à jour que lorsqu'un nouveau modèle est mis en place
// (événement `sync`).
//
var NameView = Backbone.View.extend({
  el: '#nameView',

  template: function (json) {
    return "<h1>"+ json.dev +"</h1>";
  },

  // L'événement `sync` est déclenché après `fetch`.
  initialize: function () {
    this.model.on('sync', this.render, this);
  },

  render: function () {
    this.$el.html(this.template(this.model.toJSON()));    
    return this;
  }
});

//
// La vue LangView n'est pas attachée à un élément statique du DOM. Chaque
// langage préféré de la collection a sa propre vue.
//
var LangView = Backbone.View.extend({
  tagName: 'li',

  render: function () {
    // Ici, `model` est de type `Language`.
    this.$el.html(this.model.name);
    return this;    
  }
});

//
// Cette vue est fixée à un élément statique du DOM. La vue est principalement
// concernée par les langages préférés. Par contre, lorsqu'un nouveau modèle est
// mis en place (événement `sync`), la vue doit se réabonner aux événements de
// la collection.
//
var LangCollectionView = Backbone.View.extend({
  el: '#langCollectionView',
  
  // Ici, le modèle est une instance de `Developer`.
  initialize: function () {
    this.model.on('sync', this.bindToCollectionAndRender, this);
    this.bindToCollection();
  },

  // On peut quand même s'abonner aux modifications de la liste.
  bindToCollection: function () {
    this.model.get('favoriteLanguages').on('change add remove', this.render, this);
  },

  bindToCollectionAndRender: function () {
    this.bindToCollection();
    this.render();
  },

  // On redessine complètement la liste html.
  render: function () {
    this.$('ul').empty();
    this.model.get('favoriteLanguages').each(this.addOne, this);
    return this;
  },

  // Comme mentionné précédemment, chaque langage a sa propre vue qui sera
  // ajoutée dans la liste.
  addOne: function (lang) {
    var view = new LangView({model:lang.toJSON()});
    this.$('ul').append(view.render().el);
  },

  // On ajoute des langages à la liste en s'abonnant aux clics du bouton...
  events: {
    'click button': 'onAddClick'
  },
  
  // ... et en ajoutant une nouvelle instance de la class `Language` dans la
  // liste de langages préférés.
  onAddClick: function (e) {
    this.model.get('favoriteLanguages').add({name:this.$('input').val()});
  }
});

//
// Le UndoStack permet de sauvegarder temporairement l'état d'un Developer.
// Lorsqu'un événement de modification est reçu (change, add ou remove), l'état
// est sauvegardé en format json (voir `Developer#toJSON()`). Un appel à `undo`
// rammène l'état précédent. Inversement, un appel à `redo` annule un `undo`.
//
var UndoStack = function (options) {
  this.model = options.model;
  this.initialize();
};
_.extend(UndoStack.prototype, Backbone.Events, {

  initialize: function () {
    this.reset();
    this.startListening();
  },

  startListening: function () {
    this.listenTo(this.model, 'sync', this.reset);
    // Meme si `model` est un Developer, les événements change add et remove des
    // sous-collections sont propagées. (voir `Developer#parse()`)
    this.listenTo(this.model, 'change add remove', this.save);
  },

// event handlers

  reset: function () {
    this.states = [ this.model.toJSON() ];
    this.cursor = 0;
    this.trigger('reset');
  },

  save: function () {
    if (this.cursor < this.states.length - 1) {
      this.states = this.states.slice(0, this.cursor + 1);
    }
    this.states.push(this.model.toJSON());
    this.cursor = this.states.length - 1;
    this.trigger('save');
  },

// public methods

  canUndo: function () {
    return this.cursor > 0;
  },

  undo: function () {
    if (this.canUndo()) {
      this.doDeafly(this.back, this);
      this.trigger('undo');
    }
  },

  canRedo: function () {
    return this.cursor < this.states.length - 1;
  },

  redo: function () {
    if (this.canRedo()) {
      this.doDeafly(this.forward, this);
      this.trigger('redo');
    }
  },

// private methods

  back: function () {
    this.restore(this.states[--this.cursor]);
  },

  forward: function () {
    this.restore(this.states[++this.cursor]);
  },

  restore: function (state) {
    this.model.set(this.model.parse(_.extend({}, state))).trigger('sync');
  },

  doDeafly: function (fn, context) {
    this.stopListening();
    fn.call(context);
    this.startListening();
  }
});

//
// Cette vue est abonnée aux événements d'un UndoStack. Elle affiche le bouton
// permettant d'appeler la fonction undo.
//
var UndoView = Backbone.View.extend({
  el: '#undoView',

  template: function () {
    return ""+
      "<button class='undoBtn'"+ (this.model.canUndo() ? '' : ' disabled') +">undo</button>"+
      "<button class='redoBtn'"+ (this.model.canRedo() ? '' : ' disabled') +">redo</button>";
  },

  initialize: function () {
    this.model.on('reset undo redo save', this.render, this);
  },

  render: function () {
    this.$el.html(this.template());
    return this;
  },

  events: {
    'click .undoBtn': 'onUndoClick',
    'click .redoBtn': 'onRedoClick'
  },

  onUndoClick: function () {
    this.model.undo();
  },

  onRedoClick: function () {
    this.model.redo();
  }
});

//
// Le Workspace est l'endroit où l'on initialise toutes les vues attachées à un
// éléments statique du DOM. Pour faire simple, l'instance du `Developer` en
// cours de visionnement y est conservé. Lorsque l'URL indique un nouvel `id`,
// on modifie le paramètre `id` de l'instance et on déclenche sa synchronisation
// avec le serveur (`fetch`).
//
var Workspace = Backbone.Router.extend({
  routes: {
    'developers/:id': 'findById'
  },

  initialize: function () {
    this.currentDeveloper = new Developer();
    new NameView({ model: this.currentDeveloper });
    new LangCollectionView({ model: this.currentDeveloper });

    var undoStack = new UndoStack({ model: this.currentDeveloper });
    new UndoView({ model: undoStack });

    Backbone.history.start();
  },

  findById: function (id) {
    this.currentDeveloper.id = id;
    this.currentDeveloper.fetch();
  }
});

// Go!
$(function(){
  new Workspace();
});
